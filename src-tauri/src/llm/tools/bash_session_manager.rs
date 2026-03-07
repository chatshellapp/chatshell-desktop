//! Manages per-conversation bash sessions.
//!
//! Each conversation gets its own persistent bash session handle so that
//! environment variables and working directory survive across agent turns
//! within the same conversation. Idle sessions are automatically swept
//! by a background task to prevent resource leaks.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::bash::SharedBashSession;

struct SessionEntry {
    session: SharedBashSession,
    last_used_at: Instant,
}

pub struct BashSessionManager {
    sessions: Mutex<HashMap<String, SessionEntry>>,
}

impl BashSessionManager {
    pub(crate) fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Get an existing session handle or create a new (empty) one for the given
    /// conversation. The actual `BashSession` inside is lazily created by `BashTool`
    /// on first command execution. Refreshes `last_used_at` on every access.
    pub(crate) fn get_or_create(&self, conversation_id: &str) -> SharedBashSession {
        let mut map = self.sessions.lock().unwrap();
        let entry = map
            .entry(conversation_id.to_string())
            .or_insert_with(|| SessionEntry {
                session: Arc::new(tokio::sync::Mutex::new(None)),
                last_used_at: Instant::now(),
            });
        entry.last_used_at = Instant::now();
        entry.session.clone()
    }

    /// Remove the session handle for a conversation. Any running bash process
    /// will be killed when the last `Arc` reference is dropped (via `BashSession::Drop`).
    pub(crate) fn remove(&self, conversation_id: &str) {
        let mut map = self.sessions.lock().unwrap();
        map.remove(conversation_id);
    }

    /// Remove sessions that have been idle longer than `max_idle` and kill their
    /// bash processes. Called periodically by a background sweep task.
    pub(crate) async fn sweep_idle(&self, max_idle: Duration) {
        let stale: Vec<(String, SharedBashSession)> = {
            let mut map = self.sessions.lock().unwrap();
            let now = Instant::now();
            let keys: Vec<String> = map
                .iter()
                .filter(|(_, e)| now.duration_since(e.last_used_at) > max_idle)
                .map(|(k, _)| k.clone())
                .collect();
            keys.into_iter()
                .filter_map(|k| map.remove(&k).map(|e| (k, e.session)))
                .collect()
        };

        for (conv_id, session) in stale {
            let mut guard = session.lock().await;
            if let Some(mut s) = guard.take() {
                s.kill().await;
                tracing::info!("🖥️ [bash] Swept idle session for conversation {}", conv_id);
            }
        }
    }

    /// Synchronous kill of all sessions. Called on app exit where async is unavailable.
    /// Uses `try_lock` to avoid blocking; sessions that are currently in use will be
    /// cleaned up by `BashSession::Drop` when the process exits.
    pub(crate) fn kill_all_sync(&self) {
        let mut map = self.sessions.lock().unwrap();
        for (conv_id, entry) in map.drain() {
            if let Ok(mut guard) = entry.session.try_lock() {
                if let Some(ref mut s) = *guard {
                    s.kill_sync();
                    tracing::info!(
                        "🖥️ [bash] Killed session for conversation {} on shutdown",
                        conv_id
                    );
                }
            }
        }
    }

    /// Kill all sessions (async). Waits for each process to exit.
    #[allow(dead_code)]
    pub(crate) async fn kill_all(&self) {
        let all: Vec<(String, SharedBashSession)> = {
            let mut map = self.sessions.lock().unwrap();
            map.drain().map(|(k, e)| (k, e.session)).collect()
        };

        for (conv_id, session) in all {
            let mut guard = session.lock().await;
            if let Some(mut s) = guard.take() {
                s.kill().await;
                tracing::info!(
                    "🖥️ [bash] Killed session for conversation {} on shutdown",
                    conv_id
                );
            }
        }
    }
}
