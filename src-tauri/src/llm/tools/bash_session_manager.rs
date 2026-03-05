//! Manages per-conversation bash sessions.
//!
//! Each conversation gets its own persistent bash session handle so that
//! environment variables and working directory survive across agent turns
//! within the same conversation.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::bash::SharedBashSession;

pub struct BashSessionManager {
    sessions: Mutex<HashMap<String, SharedBashSession>>,
}

impl BashSessionManager {
    pub(crate) fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Get an existing session handle or create a new (empty) one for the given
    /// conversation. The actual `BashSession` inside is lazily created by `BashTool`
    /// on first command execution.
    pub(crate) fn get_or_create(&self, conversation_id: &str) -> SharedBashSession {
        let mut map = self.sessions.lock().unwrap();
        map.entry(conversation_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(None)))
            .clone()
    }

    /// Remove the session handle for a conversation. Any running bash process
    /// will be killed when the last `Arc` reference is dropped.
    #[allow(dead_code)]
    pub(crate) fn remove(&self, conversation_id: &str) {
        let mut map = self.sessions.lock().unwrap();
        map.remove(conversation_id);
    }
}
