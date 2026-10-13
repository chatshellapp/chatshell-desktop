use serde::Serialize;
use std::io::Seek;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::{AppHandle, Manager, State};

use super::AppState;

/// Settings key holding the total log size cap in megabytes (0 = unlimited).
pub const LOG_MAX_TOTAL_MB_SETTING: &str = "log_max_total_mb";
/// Default total size cap for the logs directory.
pub const DEFAULT_LOG_MAX_TOTAL_MB: u64 = 50;
/// Files modified within this window are active and never deleted.
const ACTIVE_FILE_WINDOW_SECS: u64 = 24 * 60 * 60;

#[derive(Serialize)]
pub struct LogStorageInfo {
    pub total_bytes: u64,
    pub file_count: u64,
}

fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("logs"))
        .map_err(|e| format!("Cannot resolve app data directory: {}", e))
}

fn is_log_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    name.starts_with("chatshell-backend") || name.starts_with("chatshell-frontend")
}

fn file_metadata(entry: &std::fs::DirEntry) -> Option<(PathBuf, u64, SystemTime)> {
    let meta = entry.metadata().ok()?;
    if !meta.is_file() {
        return None;
    }
    let path = entry.path();
    if !is_log_file(&path) {
        return None;
    }
    Some((path, meta.len(), meta.modified().ok()?))
}

fn list_log_files(log_dir: &Path) -> std::io::Result<Vec<(PathBuf, u64, SystemTime)>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(log_dir)? {
        let entry = entry?;
        if let Some(file) = file_metadata(&entry) {
            files.push(file);
        }
    }
    Ok(files)
}

/// Delete oldest log files until the directory total fits within
/// `max_total_bytes`. Files modified within the last 24h (today's active
/// append targets) are never removed. A `max_total_bytes` of 0 keeps
/// everything. Returns the number of bytes freed.
pub fn enforce_log_retention(log_dir: &Path, max_total_bytes: u64) -> std::io::Result<u64> {
    let files = list_log_files(log_dir)?;
    let total: u64 = files.iter().map(|(_, len, _)| len).sum();
    if max_total_bytes == 0 || total <= max_total_bytes {
        return Ok(0);
    }

    let now = SystemTime::now();
    // Oldest first: candidates for deletion.
    let mut deletable: Vec<&(PathBuf, u64, SystemTime)> = files
        .iter()
        .filter(|(_, _, modified)| {
            now.duration_since(*modified)
                .map(|age| age.as_secs() >= ACTIVE_FILE_WINDOW_SECS)
                .unwrap_or(false)
        })
        .collect();
    deletable.sort_by_key(|(_, _, modified)| *modified);

    let mut excess = total - max_total_bytes;
    let mut freed = 0u64;
    for (path, len, _) in deletable {
        if excess == 0 {
            break;
        }
        match std::fs::remove_file(path) {
            Ok(()) => {
                freed += len;
                excess = excess.saturating_sub(*len);
                tracing::info!("Log retention removed {:?}", path);
            }
            Err(e) => tracing::warn!("Log retention failed to remove {:?}: {}", path, e),
        }
    }
    Ok(freed)
}

/// Any single log file above this size is trimmed to its tail, even when it
/// is today's active file. Guards against runaway logging (e.g. a verbose
/// level left on) that daily rotation alone cannot bound.
const PER_FILE_TRIM_THRESHOLD: u64 = 64 * 1024 * 1024;
/// Bytes of recent content kept when trimming an oversized file.
const TRIM_KEEP_BYTES: u64 = 1024 * 1024;

/// Trim every oversized log file down to its most recent `keep_bytes`.
/// Safe against concurrent appenders: on Unix the O_APPEND fd keeps writing
/// at the new end after the rewrite. Returns bytes freed.
pub fn trim_oversized_files(log_dir: &Path) -> std::io::Result<u64> {
    trim_oversized_files_with(log_dir, PER_FILE_TRIM_THRESHOLD, TRIM_KEEP_BYTES)
}

fn trim_oversized_files_with(
    log_dir: &Path,
    threshold: u64,
    keep_bytes: u64,
) -> std::io::Result<u64> {
    let mut freed = 0u64;
    for (path, len, _) in list_log_files(log_dir)? {
        if len <= threshold || len <= keep_bytes {
            continue;
        }
        let mut file = std::fs::File::open(&path)?;
        use std::io::{Read, Seek};
        file.seek(std::io::SeekFrom::End(-(keep_bytes as i64)))?;
        let mut tail = vec![0u8; keep_bytes as usize];
        file.read_exact(&mut tail)?;
        std::fs::write(&path, &tail)?;
        freed += len - keep_bytes;
        tracing::warn!(
            "Log trim: {:?} shrunk from {} to {} bytes",
            path,
            len,
            keep_bytes
        );
    }
    Ok(freed)
}

/// One full retention pass: delete oldest files over the total cap, then
/// trim any single runaway file. `max_total_bytes` of 0 disables the total
/// cap but the per-file guard still applies.
pub fn sweep_logs(log_dir: &Path, max_total_bytes: u64) -> std::io::Result<u64> {
    let freed = enforce_log_retention(log_dir, max_total_bytes)?;
    let trimmed = trim_oversized_files(log_dir)?;
    Ok(freed + trimmed)
}

#[tauri::command]
pub async fn get_log_storage_info(app: AppHandle) -> Result<LogStorageInfo, String> {
    let dir = logs_dir(&app)?;
    let files = list_log_files(&dir).map_err(|e| format!("Failed to scan logs: {}", e))?;
    Ok(LogStorageInfo {
        total_bytes: files.iter().map(|(_, len, _)| len).sum(),
        file_count: files.len() as u64,
    })
}

#[tauri::command]
pub async fn open_logs_directory(app: AppHandle) -> Result<(), String> {
    let dir = logs_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create logs directory: {}", e))?;
    tauri_plugin_opener::open_path(dir, None::<&str>)
        .map_err(|e| format!("Failed to open logs directory: {}", e))
}

/// Absolute paths of today's (local date) backend and frontend log files.
/// Used by the AI-diagnosis flow so the model can read the files itself
/// with its file tools instead of receiving a pasted excerpt.
#[tauri::command]
pub async fn get_today_log_paths(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = logs_dir(&app)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let candidates = [
        dir.join(format!("chatshell-backend.{}", today)),
        dir.join(format!("chatshell-frontend-{}.log", today)),
    ];
    Ok(candidates
        .into_iter()
        .filter(|path| path.exists())
        .map(|path| path.display().to_string())
        .collect())
}

/// Persist the total size cap (MB, 0 = unlimited) and enforce it
/// immediately. Returns the resulting storage info.
#[tauri::command]
pub async fn set_log_max_total_mb(
    state: State<'_, AppState>,
    app: AppHandle,
    max_total_mb: u64,
) -> Result<LogStorageInfo, String> {
    state
        .db
        .set_setting(LOG_MAX_TOTAL_MB_SETTING, &max_total_mb.to_string())
        .await
        .map_err(|e| e.to_string())?;

    let dir = logs_dir(&app)?;
    if let Err(e) = sweep_logs(&dir, max_total_mb * 1024 * 1024) {
        // Cap is persisted; a failed sweep (e.g. locked file) is not fatal.
        tracing::warn!("Log retention sweep failed: {}", e);
    }

    let files = list_log_files(&dir).map_err(|e| format!("Failed to scan logs: {}", e))?;
    Ok(LogStorageInfo {
        total_bytes: files.iter().map(|(_, len, _)| len).sum(),
        file_count: files.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str, contents: &str, age_secs: u64) -> (PathBuf, u64) {
        let path = dir.join(name);
        std::fs::write(&path, contents).unwrap();
        let past = SystemTime::now() - std::time::Duration::from_secs(age_secs);
        let file = std::fs::File::options().append(true).open(&path).unwrap();
        file.set_modified(past).unwrap();
        (path, contents.len() as u64)
    }
    #[test]
    fn retention_deletes_oldest_inactive_files_until_under_cap() {
        let dir = tempfile::tempdir().unwrap();
        // 100 bytes of stale logs, 10 bytes active (recent mtime).
        touch(
            dir.path(),
            "chatshell-backend.2026-10-01",
            &"x".repeat(60),
            3 * 86400,
        );
        touch(
            dir.path(),
            "chatshell-frontend-2026-10-02.log",
            &"y".repeat(30),
            2 * 86400,
        );
        touch(
            dir.path(),
            "chatshell-backend.2026-10-13",
            &"z".repeat(10),
            60,
        );

        let freed = enforce_log_retention(dir.path(), 40).unwrap();
        assert_eq!(freed, 60);
        assert!(!dir.path().join("chatshell-backend.2026-10-01").exists());
        assert!(
            dir.path()
                .join("chatshell-frontend-2026-10-02.log")
                .exists()
        );
        assert!(dir.path().join("chatshell-backend.2026-10-13").exists());
    }

    #[test]
    fn retention_never_deletes_active_files_even_over_cap() {
        let dir = tempfile::tempdir().unwrap();
        touch(
            dir.path(),
            "chatshell-backend.2026-10-13",
            &"z".repeat(100),
            60,
        );

        let freed = enforce_log_retention(dir.path(), 10).unwrap();
        assert_eq!(freed, 0);
        assert!(dir.path().join("chatshell-backend.2026-10-13").exists());
    }

    #[test]
    fn retention_zero_cap_keeps_everything() {
        let dir = tempfile::tempdir().unwrap();
        touch(
            dir.path(),
            "chatshell-backend.2026-10-01",
            &"x".repeat(100),
            3 * 86400,
        );
        assert_eq!(enforce_log_retention(dir.path(), 0).unwrap(), 0);
        assert!(dir.path().join("chatshell-backend.2026-10-01").exists());
    }

    #[test]
    fn retention_ignores_unrelated_files() {
        let dir = tempfile::tempdir().unwrap();
        touch(
            dir.path(),
            "chatshell-backend.2026-10-01",
            &"x".repeat(100),
            3 * 86400,
        );
        touch(dir.path(), "unrelated.log", &"u".repeat(1000), 3 * 86400);
        let freed = enforce_log_retention(dir.path(), 10).unwrap();
        assert_eq!(freed, 100);
        assert!(dir.path().join("unrelated.log").exists());
    }

    #[test]
    fn total_bytes_matches_file_sizes() {
        let dir = tempfile::tempdir().unwrap();
        let (_, len1) = touch(dir.path(), "chatshell-backend.2026-10-12", "abc", 86400);
        let (_, len2) = touch(dir.path(), "chatshell-frontend-2026-10-12.log", "de", 86400);
        let files = list_log_files(dir.path()).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(
            files.iter().map(|(_, len, _)| len).sum::<u64>(),
            len1 + len2
        );
    }

    #[test]
    fn trim_shrinks_oversized_file_keeping_tail() {
        let dir = tempfile::tempdir().unwrap();
        let content = format!("{}TAIL-END", "a".repeat(4096));
        touch(dir.path(), "chatshell-backend.2026-10-13", &content, 60);
        touch(dir.path(), "chatshell-backend.2026-10-12", "small", 86400);

        let freed = trim_oversized_files_with(dir.path(), 1024, 128).unwrap();
        assert_eq!(freed, content.len() as u64 - 128);
        let trimmed =
            std::fs::read_to_string(dir.path().join("chatshell-backend.2026-10-13")).unwrap();
        assert_eq!(trimmed.len(), 128);
        assert!(trimmed.ends_with("TAIL-END"));
        // Small files untouched
        assert_eq!(
            std::fs::read_to_string(dir.path().join("chatshell-backend.2026-10-12")).unwrap(),
            "small"
        );
    }

    #[test]
    fn trim_keeps_files_at_or_below_threshold() {
        let dir = tempfile::tempdir().unwrap();
        touch(
            dir.path(),
            "chatshell-backend.2026-10-13",
            &"x".repeat(1024),
            60,
        );
        assert_eq!(trim_oversized_files_with(dir.path(), 1024, 128).unwrap(), 0);
        assert_eq!(
            std::fs::metadata(dir.path().join("chatshell-backend.2026-10-13"))
                .unwrap()
                .len(),
            1024
        );
    }
}
