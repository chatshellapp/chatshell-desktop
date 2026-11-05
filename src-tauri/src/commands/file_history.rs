//! Undo for file changes made by the write and edit tools.
//!
//! Each turn's backups live under `<app_data>/file-history/<conversation>/
//! <user message id>/` (see `chatshell_agent_core::file_history`). The UI
//! offers an undo on an assistant message; it rewinds that turn and every
//! later one. Device-local: other devices' files are untouched.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use chatshell_agent_core::file_history::{self, RestoreReport};
use serde::Serialize;

/// How long a turn's backups are kept.
pub const FILE_HISTORY_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

#[derive(Debug, Serialize)]
pub struct TurnFileHistoryEntry {
    pub path: String,
    /// The file existed before the turn (false: the turn created it).
    pub existed: bool,
}

/// Files with a recorded pre-turn state for the turn answering
/// `user_message_id`.
#[tauri::command]
pub async fn get_turn_file_history(
    app: tauri::AppHandle,
    conversation_id: String,
    user_message_id: String,
) -> Result<Vec<TurnFileHistoryEntry>, String> {
    let dir = crate::storage::file_history_dir(&app, &conversation_id)
        .ok_or_else(|| "App data directory unavailable".to_string())?;
    Ok(file_history::turn_entries(&dir, &user_message_id)
        .into_iter()
        .map(|entry| TurnFileHistoryEntry {
            path: entry.path.display().to_string(),
            existed: entry.existed,
        })
        .collect())
}

/// Rewind the files changed by this turn and every later turn.
#[tauri::command]
pub async fn restore_turn_files(
    app: tauri::AppHandle,
    conversation_id: String,
    user_message_id: String,
) -> Result<RestoreReport, String> {
    let dir = crate::storage::file_history_dir(&app, &conversation_id)
        .ok_or_else(|| "App data directory unavailable".to_string())?;
    tokio::task::spawn_blocking(move || file_history::restore_from(&dir, &user_message_id))
        .await
        .map_err(|e| e.to_string())
}

/// Delete turn directories whose index is older than `ttl`, and
/// conversation directories left empty.
pub fn sweep(root: &std::path::Path, ttl: Duration, now: SystemTime) -> usize {
    let Ok(conversations) = std::fs::read_dir(root) else {
        return 0;
    };
    let mut removed = 0;
    for conversation in conversations.flatten().map(|e| e.path()) {
        let Ok(turns) = std::fs::read_dir(&conversation) else {
            continue;
        };
        for turn in turns.flatten().map(|e| e.path()) {
            let age = std::fs::metadata(turn.join("index.jsonl"))
                .and_then(|m| m.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok());
            if age.is_some_and(|age| age > ttl) && std::fs::remove_dir_all(&turn).is_ok() {
                removed += 1;
            }
        }
        let _ = std::fs::remove_dir(&conversation);
    }
    removed
}

/// `<app_data>/file-history`.
pub fn root(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("file-history")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweep_removes_expired_turns_and_empty_conversations() {
        let root = tempfile::tempdir().unwrap();
        let turn = root.path().join("conv/turn-1");
        std::fs::create_dir_all(&turn).unwrap();
        std::fs::write(turn.join("index.jsonl"), "{}").unwrap();
        let now = SystemTime::now();
        assert_eq!(sweep(root.path(), FILE_HISTORY_TTL, now), 0);
        let later = now + FILE_HISTORY_TTL + Duration::from_secs(60);
        assert_eq!(sweep(root.path(), FILE_HISTORY_TTL, later), 1);
        assert!(!root.path().join("conv").exists());
    }
}
