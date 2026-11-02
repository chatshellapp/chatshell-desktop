//! Event-driven trigger layer over [`crate::sync::run_sync_pass`].
//!
//! A fixed timer alone left two cadence gaps on desktop:
//!
//! - **Pull latency:** a peer's publish waited for the next 5-minute tick,
//!   and tokio's clock does not advance while the Mac sleeps, so opening the
//!   lid still waited out the pre-sleep remainder of the interval.
//! - **Step-away ship:** local writes shipped only on a tick or on quit, so
//!   closing the lid (or switching to the phone) stranded recent edits.
//!
//! The scheduler keeps the 5-minute tick as the backstop and adds:
//!
//! - a cheap `stat` poll of the cloud artifact (remote arrival; never reads
//!   the bytes, so a dataless iCloud placeholder is not materialized),
//! - window focus and system wake (pull now, throttled),
//! - window blur held for [`STEP_AWAY_DELAY`] and system will-sleep
//!   (terminal pass: pull, then ship pending writes bypassing the publish
//!   throttle — the desktop counterpart of the iOS background pass).
//!
//! Throttled requests are deferred to the end of the spacing window instead
//! of being dropped, so a burst of triggers always ends in one pass.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::sync::{SyncEngineHandle, SyncOutcome, SyncWiring};

/// Backstop cadence (pull + throttled flush).
pub use crate::sync::SYNC_TICK_INTERVAL;

/// Delay before the first pass after launch: lets the window and stores
/// settle before the pass contends for the database.
pub const STARTUP_DELAY: Duration = Duration::from_secs(5);

/// How often the cloud artifact's metadata is checked for remote changes.
pub const REMOTE_POLL_INTERVAL: Duration = Duration::from_secs(15);

/// Minimum spacing between event-driven pull passes.
pub const MIN_PULL_SPACING: Duration = Duration::from_secs(15);

/// How long the app must stay unfocused before the step-away pass ships
/// pending writes. Short app switches (refocus inside the window) cancel it.
pub const STEP_AWAY_DELAY: Duration = Duration::from_secs(20);

/// Upper bound for terminal passes (sleep, quit). A pass still running on
/// the blocking pool keeps running; the caller just stops waiting.
pub const TERMINAL_PASS_TIMEOUT: Duration = Duration::from_secs(20);

/// How long the will-sleep observer holds the main thread waiting for the
/// terminal pass. Best effort: the system does not promise to wait.
pub const SLEEP_WAIT_LIMIT: Duration = Duration::from_secs(10);

/// External events fed into the scheduler.
#[derive(Debug)]
pub enum SyncTrigger {
    WindowFocused,
    WindowBlurred,
    /// The system is about to sleep. The optional sender is signalled once
    /// the terminal pass finished (or timed out).
    SystemWillSleep(Option<std::sync::mpsc::Sender<()>>),
    SystemDidWake,
}

/// Managed handle used by window and power observers to reach the
/// scheduler task.
#[derive(Clone)]
pub struct SyncTriggers(mpsc::UnboundedSender<SyncTrigger>);

impl SyncTriggers {
    pub fn send(&self, trigger: SyncTrigger) {
        if self.0.send(trigger).is_err() {
            tracing::debug!("Sync scheduler is gone; trigger dropped");
        }
    }
}

/// What kind of pass to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PassKind {
    /// Pull/merge plus the throttled flush (tick and event-driven pulls).
    Pull,
    /// Pull/merge plus an unthrottled flush of pending writes (the session
    /// is ending or pausing: step-away, sleep, quit).
    Terminal,
}

/// Pure trigger bookkeeping, separated from IO so the timing rules are
/// unit-testable.
#[derive(Debug, Default)]
struct Policy {
    last_pass_at: Option<Instant>,
    pending_pull_at: Option<Instant>,
    step_away_at: Option<Instant>,
}

impl Policy {
    /// A pull was requested (remote change, focus, wake). Returns true to
    /// run now; otherwise a trailing pull is armed at the end of the
    /// spacing window so the request is deferred, never lost.
    fn request_pull(&mut self, now: Instant) -> bool {
        match self.last_pass_at {
            Some(at) if now.saturating_duration_since(at) < MIN_PULL_SPACING => {
                let due = at + MIN_PULL_SPACING;
                self.pending_pull_at = Some(self.pending_pull_at.map_or(due, |p| p.min(due)));
                false
            }
            _ => true,
        }
    }

    fn window_blurred(&mut self, now: Instant) {
        if self.step_away_at.is_none() {
            self.step_away_at = Some(now + STEP_AWAY_DELAY);
        }
    }

    fn window_focused(&mut self) {
        self.step_away_at = None;
    }

    /// The terminal pass about to run makes a pending step-away redundant.
    fn terminal_started(&mut self) {
        self.step_away_at = None;
    }

    fn next_deadline(&self) -> Option<Instant> {
        match (self.pending_pull_at, self.step_away_at) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    /// The pass whose deadline elapsed, if any. A step-away wins over a
    /// pending pull: the terminal pass pulls too.
    fn take_due(&mut self, now: Instant) -> Option<PassKind> {
        if self.step_away_at.is_some_and(|at| at <= now) {
            self.step_away_at = None;
            return Some(PassKind::Terminal);
        }
        if self.pending_pull_at.is_some_and(|at| at <= now) {
            self.pending_pull_at = None;
            return Some(PassKind::Pull);
        }
        None
    }

    /// Any pass pulls, so it satisfies a pending pull request.
    fn pass_ran(&mut self, now: Instant) {
        self.last_pass_at = Some(now);
        self.pending_pull_at = None;
    }
}

/// Change detector for the cloud artifact: mtime + size from `stat`.
/// Metadata only — reading would materialize a dataless iCloud file.
type ArtifactSignature = (SystemTime, u64);

fn artifact_path(cloud_dir: &Path) -> PathBuf {
    chatshell_agent_core::sync::encrypted_snapshot_name(
        &cloud_dir.join(chatshell_agent_core::sync::SNAPSHOT_FILE),
    )
}

fn artifact_signature(cloud_dir: &Path) -> Option<ArtifactSignature> {
    let meta = std::fs::metadata(artifact_path(cloud_dir)).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

/// The engine's cloud dir, without waiting: a pass running elsewhere (a
/// manual Sync Now) holds the engine mutex for seconds, and this runs on an
/// async worker. A busy engine reads as "unknown" and the caller skips.
fn engine_cloud_dir(engine: &SyncEngineHandle) -> Option<PathBuf> {
    engine
        .try_lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|e| e.cloud_dir().to_path_buf()))
}

struct Scheduler {
    wiring: SyncWiring,
    app: tauri::AppHandle,
    engine: SyncEngineHandle,
    db: crate::db::Database,
    policy: Policy,
    /// Artifact signature already accounted for by a pass.
    seen_signature: Option<ArtifactSignature>,
}

impl Scheduler {
    async fn run(&mut self, kind: PassKind) {
        if kind == PassKind::Terminal {
            self.policy.terminal_started();
        }
        crate::sync::ensure_engine_off_worker(&self.wiring, &self.app, &self.engine).await;

        // Capture the signature BEFORE the pass: a peer publish landing
        // while the pass runs must still look new afterwards.
        let cloud_dir = engine_cloud_dir(&self.engine);
        if let Some(dir) = cloud_dir.as_deref() {
            self.seen_signature = artifact_signature(dir);
        }

        let pass = crate::sync::run_sync_pass(
            self.engine.clone(),
            self.db.clone(),
            self.app.clone(),
            kind == PassKind::Terminal,
        );
        let result = if kind == PassKind::Terminal {
            match tokio::time::timeout(TERMINAL_PASS_TIMEOUT, pass).await {
                Ok(result) => result,
                Err(_) => {
                    tracing::warn!("Terminal sync pass exceeded {TERMINAL_PASS_TIMEOUT:?}");
                    Ok(None)
                }
            }
        } else {
            pass.await
        };

        match &result {
            Ok(Some(outcome)) => self.after_pass(outcome),
            Ok(None) => {}
            Err(err) => tracing::warn!("Sync pass ({kind:?}) failed: {err:?}"),
        }
        self.policy.pass_ran(Instant::now());
    }

    /// Our own publish rewrote the artifact: adopt its new signature so the
    /// poll does not echo a pass for it.
    fn after_pass(&mut self, outcome: &SyncOutcome) {
        let republished = outcome.republished || outcome.action == "published-initial";
        if republished && let Some(dir) = engine_cloud_dir(&self.engine) {
            self.seen_signature = artifact_signature(&dir);
        }
    }

    fn remote_changed(&self) -> bool {
        let Some(dir) = engine_cloud_dir(&self.engine) else {
            return false;
        };
        match artifact_signature(&dir) {
            Some(sig) => self.seen_signature != Some(sig),
            None => false,
        }
    }

    async fn pull_if_allowed(&mut self) {
        if self.policy.request_pull(Instant::now()) {
            self.run(PassKind::Pull).await;
        }
    }
}

/// Start the scheduler task and return the trigger handle (register it as
/// managed state so window/power observers can reach it).
pub fn spawn(
    wiring: SyncWiring,
    app: tauri::AppHandle,
    engine: SyncEngineHandle,
    db: crate::db::Database,
) -> SyncTriggers {
    let (tx, mut rx) = mpsc::unbounded_channel::<SyncTrigger>();
    tauri::async_runtime::spawn(async move {
        let mut s = Scheduler {
            wiring,
            app,
            engine,
            db,
            policy: Policy::default(),
            seen_signature: None,
        };

        // The content-key ladder does blocking I/O: Keychain reads plus the
        // iCloud artifact header, whose first read can trigger a
        // dataless-file download measured in seconds. It must never run on
        // the main thread (first-launch hang, 2026-10-13); running it at
        // t=0 keeps the engine install and the sync-locked banner timing.
        crate::sync::ensure_engine_off_worker(&s.wiring, &s.app, &s.engine).await;
        tokio::time::sleep(STARTUP_DELAY).await;
        s.run(PassKind::Pull).await;

        let now = Instant::now();
        let mut tick = tokio::time::interval_at(now + SYNC_TICK_INTERVAL, SYNC_TICK_INTERVAL);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut poll = tokio::time::interval_at(now + REMOTE_POLL_INTERVAL, REMOTE_POLL_INTERVAL);
        poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            let deadline = s.policy.next_deadline();
            tokio::select! {
                _ = tick.tick() => s.run(PassKind::Pull).await,
                _ = poll.tick() => {
                    if s.remote_changed() {
                        s.pull_if_allowed().await;
                    }
                }
                _ = tokio::time::sleep_until(deadline.unwrap_or_else(Instant::now)),
                    if deadline.is_some() =>
                {
                    if let Some(kind) = s.policy.take_due(Instant::now()) {
                        s.run(kind).await;
                    }
                }
                trigger = rx.recv() => {
                    let Some(trigger) = trigger else { break };
                    match trigger {
                        SyncTrigger::WindowFocused => {
                            s.policy.window_focused();
                            s.pull_if_allowed().await;
                        }
                        SyncTrigger::WindowBlurred => s.policy.window_blurred(Instant::now()),
                        SyncTrigger::SystemDidWake => {
                            // The tick's clock stood still during sleep;
                            // restart the backstop from now and pull.
                            tick.reset();
                            s.pull_if_allowed().await;
                        }
                        SyncTrigger::SystemWillSleep(ack) => {
                            s.run(PassKind::Terminal).await;
                            if let Some(ack) = ack {
                                let _ = ack.send(());
                            }
                        }
                    }
                }
            }
        }
    });
    SyncTriggers(tx)
}

/// Quit-time pass: pull first, then ship pending writes unthrottled — a
/// blind publish could overwrite a newer peer snapshot that landed since
/// the last pass. Blob upload runs inside the pass (blobs-before-snapshots).
/// Bounded so quitting never hangs on a slow or dataless container.
pub fn run_exit_pass(engine: SyncEngineHandle, db: crate::db::Database, app: tauri::AppHandle) {
    // Blocking lock is fine here: this runs on the main thread at exit,
    // after the event loop stopped, and waiting out an in-flight pass is
    // exactly what a final pass should do.
    let present = engine.lock().map(|g| g.is_some()).unwrap_or(false);
    if !present {
        return;
    }
    let result = tauri::async_runtime::block_on(tokio::time::timeout(
        TERMINAL_PASS_TIMEOUT,
        crate::sync::run_sync_pass(engine, db, app, true),
    ));
    match result {
        Ok(Ok(Some(outcome))) => {
            tracing::info!("Exit sync pass: {}", outcome.action);
        }
        Ok(Ok(None)) => {}
        Ok(Err(err)) => tracing::warn!("Exit sync pass failed: {err:#}"),
        Err(_) => tracing::warn!("Exit sync pass exceeded {TERMINAL_PASS_TIMEOUT:?}"),
    }
}

/// Register NSWorkspace sleep/wake observers feeding the scheduler. Must be
/// called on the main thread (NSWorkspace posts there). Observers live for
/// the process lifetime.
#[cfg(target_os = "macos")]
pub fn install_power_observers(triggers: SyncTriggers) {
    use block2::RcBlock;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::NSNotification;
    use std::ptr::NonNull;

    let center = NSWorkspace::sharedWorkspace().notificationCenter();

    let sleep_triggers = triggers.clone();
    let will_sleep = RcBlock::new(move |_note: NonNull<NSNotification>| {
        let (tx, rx) = std::sync::mpsc::channel();
        sleep_triggers.send(SyncTrigger::SystemWillSleep(Some(tx)));
        // Hold the posting (main) thread briefly so the terminal pass can
        // land before the machine sleeps. Best effort and bounded.
        if rx.recv_timeout(SLEEP_WAIT_LIMIT).is_err() {
            tracing::warn!("Sleep sync pass did not finish within {SLEEP_WAIT_LIMIT:?}");
        }
    });
    let wake_triggers = triggers;
    let did_wake = RcBlock::new(move |_note: NonNull<NSNotification>| {
        wake_triggers.send(SyncTrigger::SystemDidWake);
    });

    // SAFETY: names are AppKit's static notification names; `obj` is nil;
    // the blocks are `'static` and only touch the `Send` channel handle;
    // `queue` nil runs them synchronously on the posting thread.
    unsafe {
        let sleep_token = center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceWillSleepNotification),
            None,
            None,
            &will_sleep,
        );
        let wake_token = center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidWakeNotification),
            None,
            None,
            &did_wake,
        );
        // Process-lifetime observers: keep the tokens alive forever.
        std::mem::forget(sleep_token);
        std::mem::forget(wake_token);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publish_throttle_sits_below_the_tick() {
        // Throttle == tick made every other tick skip its flush (the publish
        // stamp lands after the pass), doubling the ship cadence.
        assert!(
            chatshell_agent_core::sync::PUBLISH_MIN_INTERVAL + Duration::from_secs(15)
                <= SYNC_TICK_INTERVAL
        );
    }

    #[test]
    fn first_pull_runs_immediately() {
        let mut p = Policy::default();
        assert!(p.request_pull(Instant::now()));
        assert_eq!(p.next_deadline(), None);
    }

    #[test]
    fn throttled_pull_is_deferred_not_dropped() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        p.pass_ran(t0);
        assert!(!p.request_pull(t0 + Duration::from_secs(3)));
        assert_eq!(p.next_deadline(), Some(t0 + MIN_PULL_SPACING));
        // Repeated requests inside the window keep one trailing pull.
        assert!(!p.request_pull(t0 + Duration::from_secs(10)));
        assert_eq!(p.next_deadline(), Some(t0 + MIN_PULL_SPACING));
        assert_eq!(p.take_due(t0 + Duration::from_secs(14)), None);
        assert_eq!(p.take_due(t0 + MIN_PULL_SPACING), Some(PassKind::Pull));
        assert_eq!(p.next_deadline(), None);
    }

    #[test]
    fn pull_after_spacing_runs_now() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        p.pass_ran(t0);
        assert!(p.request_pull(t0 + MIN_PULL_SPACING));
    }

    #[test]
    fn any_pass_satisfies_a_pending_pull() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        p.pass_ran(t0);
        assert!(!p.request_pull(t0 + Duration::from_secs(1)));
        p.pass_ran(t0 + Duration::from_secs(2));
        assert_eq!(p.next_deadline(), None);
    }

    #[test]
    fn blur_arms_step_away_and_focus_cancels_it() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        p.window_blurred(t0);
        assert_eq!(p.next_deadline(), Some(t0 + STEP_AWAY_DELAY));
        p.window_focused();
        assert_eq!(p.next_deadline(), None);

        p.window_blurred(t0);
        // A second blur does not push the deadline out.
        p.window_blurred(t0 + Duration::from_secs(5));
        assert_eq!(p.next_deadline(), Some(t0 + STEP_AWAY_DELAY));
        assert_eq!(p.take_due(t0 + STEP_AWAY_DELAY), Some(PassKind::Terminal));
        assert_eq!(p.next_deadline(), None);
    }

    #[test]
    fn step_away_wins_over_a_pending_pull() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        p.pass_ran(t0);
        assert!(!p.request_pull(t0));
        p.window_blurred(t0);
        // Both deadlines have elapsed by now.
        let due = t0 + MIN_PULL_SPACING.max(STEP_AWAY_DELAY);
        assert_eq!(p.take_due(due), Some(PassKind::Terminal));
        assert_eq!(p.take_due(due), Some(PassKind::Pull));
    }

    #[test]
    fn terminal_pass_clears_pending_step_away() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        p.window_blurred(t0);
        p.terminal_started();
        assert_eq!(p.next_deadline(), None);
    }

    #[test]
    fn artifact_signature_tracks_rewrites() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(artifact_signature(tmp.path()), None);
        let path = artifact_path(tmp.path());
        std::fs::write(&path, b"one").unwrap();
        let first = artifact_signature(tmp.path()).expect("signature");
        std::fs::write(&path, b"three").unwrap();
        let second = artifact_signature(tmp.path()).expect("signature");
        assert_ne!(first, second, "size change must change the signature");
    }
}
