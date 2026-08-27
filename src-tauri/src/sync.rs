//! Desktop snapshot-sync glue (Phase 3a/3b + ADR 04 enablement).
//!
//! The engine itself lives in `chatshell-agent-core::sync`; this module adds
//! macOS iCloud container detection, the background sync scheduler with the
//! graded content-key ladder, and re-exports the engine for the app state.

use std::path::PathBuf;
use std::sync::Arc;

use crate::blob_sync;
use crate::sync_crypto_state::{self, CkResolution};
use tauri::Manager as _;

pub use chatshell_agent_core::sync::{SyncEngine, SyncOutcome};
use chatshell_agent_core::sync_crypto::SyncCrypto;

/// Interval between background sync passes (pull + throttled flush).
/// Idle passes are near-free: the engine's dirty detection skips the
/// snapshot publish unless the app pool wrote since the last one.
pub const SYNC_TICK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Shared engine slot (absent while sync is disabled or the content key is
/// not yet available).
pub type SyncEngineHandle = Arc<std::sync::Mutex<Option<SyncEngine>>>;

/// Everything the sync wiring needs to (re)construct engines.
#[derive(Clone)]
pub struct SyncWiring {
    pub app_data_dir: PathBuf,
    pub db_path: PathBuf,
    /// App-private staging directory for decrypted snapshots (never the
    /// OS temp dir — ADR 04 §1).
    pub cache_dir: PathBuf,
}

/// Resolve the current sync target: the iCloud container when provisioned.
/// Debug builds fall back to a local staging dir so publish/sync_now stay
/// exercisable; release builds are structurally off without the container
/// (ADR 04 §7 — the de-facto always-on staging fallback is corrected here).
pub fn resolve_sync_target(app_data_dir: &std::path::Path) -> Option<(PathBuf, &'static str)> {
    if let Some(dir) = detect_icloud_container() {
        return Some((dir, "iCloud container"));
    }
    #[cfg(debug_assertions)]
    {
        let staging = app_data_dir.join("sync-staging");
        std::fs::create_dir_all(&staging).ok()?;
        #[allow(unreachable_code)]
        return Some((staging, "local staging dir (debug)"));
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

impl SyncWiring {
    /// Install an encrypting engine built from `crypto` into the shared
    /// slot, replacing any stale engine.
    pub fn install_engine(
        &self,
        slot: &SyncEngineHandle,
        cloud_dir: PathBuf,
        crypto: SyncCrypto,
    ) -> anyhow::Result<()> {
        let engine = SyncEngine::new(
            &self.db_path,
            cloud_dir.clone(),
            self.cache_dir.clone(),
            Some(crypto),
        )?;
        let mut guard = slot
            .lock()
            .map_err(|_| anyhow::anyhow!("sync engine poisoned"))?;
        *guard = Some(engine);
        Ok(())
    }

    /// Drop the engine without touching device state (used when the key
    /// material is missing: the ladder owns the recovery).
    pub fn drop_engine(&self, slot: &SyncEngineHandle) {
        if let Ok(mut guard) = slot.lock() {
            *guard = None;
        }
    }

    /// Try to (re)construct the engine when enabled but absent, running the
    /// graded content-key ladder (ADR 04 §3 rule 2). Emits `sync-locked`
    /// when the passphrase rung is reached; silent otherwise — Keychain
    /// propagation delay is normal, and the tick's cadence is the backoff.
    pub fn ensure_engine(&self, app: &tauri::AppHandle, slot: &SyncEngineHandle) {
        let settings = sync_crypto_state::load_settings(&self.app_data_dir);
        if !settings.enabled {
            return;
        }
        let Some((cloud_dir, reason)) = resolve_sync_target(&self.app_data_dir) else {
            tracing::info!("Snapshot sync waiting for the iCloud container");
            return;
        };
        if let Ok(guard) = slot.lock()
            && guard.is_some()
        {
            return;
        }
        match sync_crypto_state::resolve_content_key(&self.app_data_dir, &cloud_dir, &settings) {
            CkResolution::Ready(crypto) => match self.install_engine(slot, cloud_dir, crypto) {
                Ok(()) => tracing::info!("Snapshot sync enabled ({reason})"),
                Err(err) => tracing::warn!("Snapshot sync disabled: {err}"),
            },
            CkResolution::NeedBootstrap => {
                // Onboarding owns this; nothing to do silently here.
            }
            CkResolution::NeedPassphrase => {
                use tauri::Emitter;
                if let Err(err) = app.emit("sync-locked", ()) {
                    tracing::warn!("Failed to emit sync-locked: {err}");
                }
            }
        }
    }
}

/// Run one sync pass against the cloud snapshot: pull/merge, then flush
/// pending local writes (throttled inside the engine). When the merge pulled
/// rows, incrementally reconcile the FTS index (merged rows bypass the sqlx
/// insert path that normally maintains it) and emit `sync-merged` so the
/// frontend can reload its stores without an app restart.
///
/// Returns the engine outcome (`None` = sync disabled on this machine) so
/// the manual `sync_now` command can run the exact same path as the
/// scheduler. Blob upload runs first either way: blobs-before-snapshots is
/// what keeps peers from ever seeing a dangling hash. A key-material
/// failure (sync group reset elsewhere, rotated key we never learned) drops
/// the engine and re-enters the acquisition ladder at the passphrase rung —
/// never an error loop (ADR 04 §3 rule 2).
pub async fn run_sync_pass(
    engine: SyncEngineHandle,
    db: crate::db::Database,
    app: tauri::AppHandle,
) -> anyhow::Result<Option<SyncOutcome>> {
    use tauri::Emitter;

    // Ship new attachment bytes before the pass: any snapshot this pass
    // publishes may reference them, and blobs-before-snapshots is what keeps
    // peers from ever seeing a dangling hash.
    let (cloud_dir, keys) = match engine.lock() {
        Ok(guard) => match guard.as_ref() {
            Some(engine) => (
                Some(engine.cloud_dir().to_path_buf()),
                engine.crypto().map(|c| c.keys().clone()),
            ),
            None => (None, None),
        },
        Err(_) => {
            tracing::warn!("sync engine poisoned; skipping blob upload");
            (None, None)
        }
    };
    let attach_dir = crate::storage::get_attachments_dir(&app).ok();
    if let (Some(dir), Some(attach), Some(keys)) =
        (cloud_dir.as_ref(), attach_dir.as_ref(), keys.as_ref())
        && let Err(err) = blob_sync::ensure_referenced_blobs_uploaded(&db, dir, attach, keys).await
    {
        tracing::warn!("Blob upload before sync failed: {err:#}");
    }

    let engine_for_task = engine.clone();
    let sync_result =
        tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Option<SyncOutcome>> {
            let mut guard = engine_for_task
                .lock()
                .map_err(|_| anyhow::anyhow!("sync engine poisoned"))?;
            match guard.as_mut() {
                Some(engine) => Ok(Some(engine.sync_now()?)),
                None => Ok(None),
            }
        })
        .await
        .map_err(|e| anyhow::anyhow!("sync task join failed: {e}"))?;

    let outcome = match sync_result {
        Ok(outcome) => outcome,
        Err(err) => {
            // Classify: key-material failures re-enter the ladder at the
            // passphrase rung (latching needs_unlock so the ladder cannot
            // loop on the stale rungs); everything else stays a logged
            // error the next tick retries.
            if sync_crypto_state::is_key_material_error(&err) {
                tracing::warn!("Sync content key rejected by the cloud artifact: {err:#}");
                if let Ok(app_data_dir) = app.path().app_data_dir() {
                    engine.lock().ok().and_then(|mut guard| guard.take());
                    sync_crypto_state::enter_needs_unlock(&app_data_dir);
                    if let Err(err) = app.emit("sync-locked", ()) {
                        tracing::warn!("Failed to emit sync-locked: {err}");
                    }
                    return Ok(None);
                }
            }
            return Err(err);
        }
    };

    let outcome = match outcome {
        Some(outcome) => outcome,
        // Sync disabled on this machine; not an error.
        None => return Ok(None),
    };

    // Persist the (possibly slot-refreshed, proven-by-use) chain after a
    // successful pass so the next launch resolves from the cache.
    if let (Ok(app_data_dir), Ok(guard)) = (app.path().app_data_dir(), engine.lock())
        && let Some(engine) = guard.as_ref()
        && let Some(crypto) = engine.crypto()
    {
        let _ = sync_crypto_state::persist_chain(&app_data_dir, crypto);
    }

    if outcome.rows_merged > 0 {
        tracing::info!("Sync pulled {} rows", outcome.rows_merged);
        if let Err(err) = db.sync_fts_incremental().await {
            tracing::warn!("Incremental FTS sync failed: {err}");
        }
        if let Err(err) = app.emit("sync-merged", outcome.rows_merged) {
            tracing::warn!("Failed to emit sync-merged event: {err}");
        }
    } else if outcome.action == "flushed" {
        tracing::info!("Sync flushed pending local writes");
    }

    // Opportunistic blob GC, at most once a day per process. Only after a
    // pass that shipped something - an idle up-to-date tick has no new
    // information about orphans anyway.
    if (outcome.republished || outcome.rows_merged > 0)
        && let Some(dir) = cloud_dir.clone()
    {
        let last = LAST_BLOB_GC.load(std::sync::atomic::Ordering::Relaxed);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let elapsed = now.saturating_sub(last);
        if elapsed > 24 * 60 * 60
            && LAST_BLOB_GC
                .compare_exchange(
                    last,
                    now,
                    std::sync::atomic::Ordering::Relaxed,
                    std::sync::atomic::Ordering::Relaxed,
                )
                .is_ok()
            && let Err(err) = blob_sync::gc_orphan_blobs(&db, &dir, blob_sync::GC_GRACE_SECS).await
        {
            tracing::warn!("Blob GC failed: {err:#}");
        }
    }

    Ok(Some(outcome))
}

/// Unix seconds of the last opportunistic blob GC (process-local throttle).
static LAST_BLOB_GC: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

/// Default iCloud container directory for this app
/// (`iCloud.app.chatshell` per the entitlements inventory), if it exists.
/// Desktop never creates it: the iOS side provisions the container.
pub fn detect_icloud_container() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    let path = std::path::PathBuf::from(home)
        .join("Library")
        .join("Mobile Documents")
        .join("iCloud~app~chatshell");
    path.is_dir().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chatshell_agent_core::sync::{META_SYNC_VERSION, get_meta};
    use std::path::{Path, PathBuf};

    /// Build a production-schema database (through the app's own schema code)
    /// at `path`, with a conversation row.
    async fn make_db(path: &Path, _tag: &str, title: &str) -> crate::db::Database {
        let db = crate::db::Database::new(path.to_str().unwrap())
            .await
            .expect("db init");
        db.create_conversation(crate::models::CreateConversationRequest {
            title: title.to_string(),
        })
        .await
        .expect("conversation");
        db
    }

    fn unique_tag() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    fn cloud_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "chatshell-sync-test-{}-{}-{}",
            tag,
            std::process::id(),
            unique_tag()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Remove a database file plus any WAL side files left by a pool that
    /// never closed cleanly (stale -wal resurrects old meta rows).
    fn remove_db(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[tokio::test]
    async fn two_devices_converge_through_cloud_snapshot() {
        let tag = unique_tag();
        let base = std::env::temp_dir().join(format!("sync-a-{}", tag));
        let b_path = std::env::temp_dir().join(format!("sync-b-{}", tag));
        remove_db(&base);
        remove_db(&b_path);
        let a_db = make_db(&base, "a", "from A").await;

        let cloud = cloud_dir("converge");
        let staging_a = std::env::temp_dir().join(format!("sync-stage-a-{tag}"));
        let mut a = SyncEngine::new(&base, cloud.clone(), staging_a, None).unwrap();

        // Device A publishes its initial state.
        let out = a.sync_now().unwrap();
        assert_eq!(out.action, "published-initial");

        // Device B (second database file) pulls A's rows and republishes.
        let b_db = make_db(&b_path, "c2", "from B").await;
        let staging_b = std::env::temp_dir().join(format!("sync-stage-b-{tag}"));
        let mut b = SyncEngine::new(&b_path, cloud.clone(), staging_b, None).unwrap();
        let out_b = b.sync_now().unwrap();
        assert!(out_b.rows_merged > 0, "B must pull A's rows: {out_b:?}");
        assert!(out_b.republished, "B republishes the merged state");

        // A pulls B's rows and republishes under a fresh version id.
        let out_a2 = a.sync_now().unwrap();
        assert!(out_a2.rows_merged > 0, "A must pull B's rows: {out_a2:?}");

        // B's next pass finds nothing new: content already equals A's
        // snapshot, so B adopts A's version id (converged, no republish).
        let out_b2 = b.sync_now().unwrap();
        assert_eq!(out_b2.action, "converged", "{out_b2:?}");
        assert!(!out_b2.republished, "{out_b2:?}");

        // Version ids converged; further passes are no-ops on both sides.
        let a_version = get_meta(a.connection(), META_SYNC_VERSION)
            .unwrap()
            .unwrap();
        let b_version = get_meta(b.connection(), META_SYNC_VERSION)
            .unwrap()
            .unwrap();
        assert_eq!(a_version, b_version, "version ids must converge");
        assert_eq!(a.sync_now().unwrap().action, "up-to-date");
        assert_eq!(b.sync_now().unwrap().action, "up-to-date");

        // Both databases hold both conversations.
        for db in [&a_db, &b_db] {
            let convs = db.list_conversations().await.unwrap();
            let titles: Vec<&str> = convs.iter().map(|c| c.title.as_str()).collect();
            assert!(titles.contains(&"from A"), "{titles:?}");
            assert!(titles.contains(&"from B"), "{titles:?}");
        }

        drop(a);
        drop(b);
        drop(a_db);
        drop(b_db);
        remove_db(&base);
        remove_db(&b_path);
        let _ = std::fs::remove_dir_all(&cloud);
    }

    #[tokio::test]
    async fn publish_without_changes_keeps_version_id() {
        let path = std::env::temp_dir().join(format!("sync-p-{}", unique_tag()));
        remove_db(&path);
        let _db = make_db(&path, "c1", "t").await;
        let cloud = cloud_dir("publish");
        let staging = std::env::temp_dir().join(format!("sync-stage-p-{}", unique_tag()));
        let mut engine = SyncEngine::new(&path, cloud.clone(), staging, None).unwrap();
        engine.publish().unwrap();
        let v1 = get_meta(engine.connection(), META_SYNC_VERSION)
            .unwrap()
            .unwrap();
        engine.publish().unwrap();
        let v2 = get_meta(engine.connection(), META_SYNC_VERSION)
            .unwrap()
            .unwrap();
        assert_eq!(v1, v2, "republish without writes keeps the id");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(&cloud);
    }

    #[tokio::test]
    async fn dirty_detection_sees_pool_writes() {
        let path = std::env::temp_dir().join(format!("sync-d-{}", unique_tag()));
        remove_db(&path);
        let db = make_db(&path, "c1", "t").await;
        let cloud = cloud_dir("dirty");
        let staging = std::env::temp_dir().join(format!("sync-stage-d-{}", unique_tag()));
        let mut engine = SyncEngine::new(&path, cloud.clone(), staging, None).unwrap();
        engine.publish().unwrap();
        let v1 = get_meta(engine.connection(), META_SYNC_VERSION)
            .unwrap()
            .unwrap();

        // Write through the sqlx pool (another connection) -> dirty.
        db.create_conversation(crate::models::CreateConversationRequest {
            title: "second".to_string(),
        })
        .await
        .unwrap();

        engine.publish().unwrap();
        let v2 = get_meta(engine.connection(), META_SYNC_VERSION)
            .unwrap()
            .unwrap();
        assert_ne!(v1, v2, "pool writes must bump the version id");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(&cloud);
    }

    #[test]
    fn container_detection_absent() {
        // Not asserting presence (machine-dependent): the detector must
        // simply not panic and return None when missing.
        let result = detect_icloud_container();
        assert!(result.is_none() || result.unwrap().is_dir());
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Live round-trip against the REAL desktop database and the REAL iCloud
    /// container path. Opt-in only (touches user data + creates the Mac-side
    /// container folder): `cargo test --lib sync::live_tests -- --ignored`.
    #[test]
    #[ignore = "touches the real database and container path"]
    fn live_container_roundtrip() {
        let db_path = std::env::var_os("HOME")
            .map(|h| {
                std::path::PathBuf::from(h)
                    .join("Library/Application Support/app.chatshell.desktop/data.db")
            })
            .expect("HOME");
        if !db_path.exists() {
            panic!("real desktop database not found at {}", db_path.display());
        }
        let container = std::env::var_os("HOME")
            .map(|h| {
                std::path::PathBuf::from(h).join("Library/Mobile Documents/iCloud~app~chatshell")
            })
            .unwrap();
        // Validation run: the Mac-side folder may legitimately not exist yet
        // (iOS provisions it). For this live test we create it - iCloud's
        // bird daemon reconciles it into the container once an entitled app
        // has run on any device.
        std::fs::create_dir_all(&container).expect("create container dir");

        let mut engine = SyncEngine::new(&db_path, container.clone(), std::env::temp_dir(), None)
            .expect("engine");
        engine.publish().expect("publish real data");
        let snapshot = container.join(chatshell_agent_core::sync::SNAPSHOT_FILE);
        assert!(snapshot.exists(), "snapshot published");
        let size = std::fs::metadata(&snapshot).unwrap().len();
        println!("published snapshot: {} bytes", size);
        assert!(size > 0, "snapshot must be non-empty (real database)");

        // A second pass must be a no-op (idempotent against our own output).
        let out = engine.sync_now().expect("sync_now");
        assert_eq!(out.action, "up-to-date", "{out:?}");
        println!("second pass: {:?}", out);
    }
}
