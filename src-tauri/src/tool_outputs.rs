//! Durable store for spilled tool output (`tool-output://` references).
//!
//! Bash output past the inline cap streams to
//! `<app_cache>/tool-outputs/<conversation_id>/bash-<uuid>.txt`. Files live
//! as long as the conversation, capped by a 7-day TTL swept at startup;
//! deleting a conversation removes its directory. The store is a private
//! read root: the model reaches a file only through its conversation's
//! `tool-output://` reference. Device-local, never synced.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::Manager;

/// How long a spill file is kept.
pub const TOOL_OUTPUT_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// `<app_cache>/tool-outputs`.
pub fn root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_cache_dir()
        .ok()
        .map(|dir| dir.join("tool-outputs"))
}

/// The spill directory of one conversation.
pub fn conversation_dir(root: &Path, conversation_id: &str) -> PathBuf {
    root.join(conversation_id)
}

/// Remove a conversation's spill directory.
pub fn remove_conversation(root: &Path, conversation_id: &str) {
    let dir = conversation_dir(root, conversation_id);
    if dir.exists()
        && let Err(e) = std::fs::remove_dir_all(&dir)
    {
        tracing::warn!("🧹 [tool_outputs] Could not remove {}: {e}", dir.display());
    }
}

/// Delete spill files older than `ttl` and the directories left empty.
/// Returns the number of files deleted.
pub fn sweep(root: &Path, ttl: Duration, now: SystemTime) -> usize {
    let Ok(conversations) = std::fs::read_dir(root) else {
        return 0;
    };
    let mut deleted = 0;
    for conversation in conversations.flatten() {
        let dir = conversation.path();
        if !dir.is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&dir) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            let expired = file
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age > ttl);
            if expired && std::fs::remove_file(&path).is_ok() {
                deleted += 1;
            }
        }
        // Fails (and keeps the directory) while it still holds files.
        let _ = std::fs::remove_dir(&dir);
    }
    deleted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweep_removes_expired_files_and_empty_directories() {
        let root = tempfile::tempdir().unwrap();
        let fresh = root.path().join("conv-fresh");
        let stale = root.path().join("conv-stale");
        std::fs::create_dir_all(&fresh).unwrap();
        std::fs::create_dir_all(&stale).unwrap();
        std::fs::write(fresh.join("bash-1.txt"), "keep").unwrap();
        std::fs::write(stale.join("bash-2.txt"), "drop").unwrap();

        // Sweep "8 days later"; the fresh file was modified at that time.
        let later = SystemTime::now() + Duration::from_secs(8 * 24 * 60 * 60);
        let fresh_file = std::fs::File::options()
            .write(true)
            .open(fresh.join("bash-1.txt"))
            .unwrap();
        fresh_file.set_modified(later).unwrap();

        assert_eq!(sweep(root.path(), TOOL_OUTPUT_TTL, later), 1);
        assert!(fresh.join("bash-1.txt").exists());
        assert!(!stale.exists(), "emptied directory is removed");
    }

    #[test]
    fn removing_a_conversation_deletes_its_directory() {
        let root = tempfile::tempdir().unwrap();
        let dir = conversation_dir(root.path(), "conv");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bash-1.txt"), "x").unwrap();
        remove_conversation(root.path(), "conv");
        assert!(!dir.exists());
        // Missing directories are fine.
        remove_conversation(root.path(), "conv");
    }
}
