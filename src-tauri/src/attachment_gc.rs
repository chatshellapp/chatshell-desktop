//! Local attachment garbage collection.
//!
//! Deleting a message tombstones its `message_attachments` links, but the
//! `files` rows (which dedup can share across messages) stay live, so
//! neither the cloud blob GC (`blob_sync::gc_orphan_blobs`, keyed on live
//! `files` rows) nor anything local ever reclaimed their bytes. Two passes,
//! run at startup:
//!
//! 1. Tombstone `files` rows that no live link of a live message references
//!    and that are older than [`UNLINKED_FILE_GRACE`] (a fresh row is linked
//!    milliseconds after it is created). The tombstone syncs, so peers and
//!    the cloud GC reclaim the same bytes.
//! 2. Delete blobs in `attachments/files/` that no live `files` row names
//!    and that are older than [`LOCAL_BLOB_GRACE`] (a send in flight writes
//!    the blob just before its row).

use std::path::Path;
use std::time::{Duration, SystemTime};

use crate::db::Database;

/// Age before an unlinked `files` row is tombstoned.
pub const UNLINKED_FILE_GRACE: Duration = Duration::from_secs(24 * 60 * 60);
/// Age before an unreferenced local blob is deleted.
pub const LOCAL_BLOB_GRACE: Duration = Duration::from_secs(60 * 60);

/// Pass 1: tombstone unlinked `files` rows created before `cutoff`.
pub async fn tombstone_unlinked_files(
    db: &Database,
    cutoff: chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<u64> {
    let sql = crate::db::soft_delete::tombstone_update(
        "files",
        "deleted_at IS NULL AND created_at < ?2 AND NOT EXISTS (
             SELECT 1 FROM message_attachments ma
             JOIN messages m ON m.id = ma.message_id
             WHERE ma.attachment_id = files.id
               AND ma.deleted_at IS NULL AND m.deleted_at IS NULL)",
    );
    let result = sqlx::query(&sql)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(cutoff.to_rfc3339())
        .execute(db.pool())
        .await?;
    Ok(result.rows_affected())
}

/// Pass 2: delete blobs in `files_dir` no live row names, older than
/// `grace` at `now`.
pub async fn sweep_local_blobs(
    db: &Database,
    files_dir: &Path,
    grace: Duration,
    now: SystemTime,
) -> anyhow::Result<usize> {
    // Compare by file name: iOS-authored rows can carry absolute paths.
    let live: std::collections::HashSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT storage_path FROM files WHERE deleted_at IS NULL AND storage_path != ''",
    )
    .fetch_all(db.pool())
    .await?
    .into_iter()
    .filter_map(|path| {
        Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_string)
    })
    .collect();

    let Ok(entries) = std::fs::read_dir(files_dir) else {
        return Ok(0);
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if live.contains(&name) {
            continue;
        }
        let old_enough = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= grace);
        if old_enough {
            match std::fs::remove_file(&path) {
                Ok(()) => removed += 1,
                Err(e) => tracing::warn!(
                    "🧹 [attachment_gc] Could not remove {}: {e}",
                    path.display()
                ),
            }
        }
    }
    Ok(removed)
}

/// Both passes; logs what it reclaimed.
pub async fn run(db: &Database, attachments_dir: &Path) {
    let cutoff =
        chrono::Utc::now() - chrono::Duration::from_std(UNLINKED_FILE_GRACE).unwrap_or_default();
    match tombstone_unlinked_files(db, cutoff).await {
        Ok(0) => {}
        Ok(n) => tracing::info!("🧹 [attachment_gc] Tombstoned {n} unlinked file row(s)"),
        Err(e) => tracing::warn!("🧹 [attachment_gc] Unlinked file pass failed: {e:#}"),
    }
    match sweep_local_blobs(
        db,
        &attachments_dir.join("files"),
        LOCAL_BLOB_GRACE,
        SystemTime::now(),
    )
    .await
    {
        Ok(0) => {}
        Ok(n) => tracing::info!("🧹 [attachment_gc] Removed {n} unreferenced blob(s)"),
        Err(e) => tracing::warn!("🧹 [attachment_gc] Blob pass failed: {e:#}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateFileAttachmentRequest, CreateMessageRequest};

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at)
             VALUES ('conv', 'test', ?, ?)",
        )
        .bind(&now)
        .bind(&now)
        .execute(db.pool())
        .await
        .unwrap();
        (db, dir)
    }

    async fn file(db: &Database, storage_path: &str) -> String {
        db.create_file_attachment(CreateFileAttachmentRequest {
            file_name: "f".to_string(),
            file_size: 1,
            mime_type: "text/plain".to_string(),
            storage_path: storage_path.to_string(),
            content_hash: storage_path.to_string(),
        })
        .await
        .unwrap()
        .id
    }

    async fn message(db: &Database) -> String {
        db.create_message(CreateMessageRequest {
            conversation_id: Some("conv".to_string()),
            parent_id: None,
            sender_type: "user".to_string(),
            sender_id: None,
            content: "hi".to_string(),
            tokens: None,
        })
        .await
        .unwrap()
        .id
    }

    async fn live_paths(db: &Database) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT storage_path FROM files WHERE deleted_at IS NULL ORDER BY storage_path",
        )
        .fetch_all(db.pool())
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn unlinked_rows_are_tombstoned_after_the_grace_period() {
        let (db, _dir) = test_db().await;
        let kept_msg = message(&db).await;
        let kept = file(&db, "files/kept.txt").await;
        db.link_message_attachment(&kept_msg, &kept, None)
            .await
            .unwrap();
        let gone_msg = message(&db).await;
        let gone = file(&db, "files/gone.txt").await;
        db.link_message_attachment(&gone_msg, &gone, None)
            .await
            .unwrap();
        file(&db, "files/never-linked.txt").await;
        // Deleting a message tombstones its links, not the files row.
        db.delete_messages_from("conv", &gone_msg).await.unwrap();

        // Inside the grace period nothing is touched.
        let past = chrono::Utc::now() - chrono::Duration::hours(1);
        assert_eq!(tombstone_unlinked_files(&db, past).await.unwrap(), 0);

        let future = chrono::Utc::now() + chrono::Duration::seconds(5);
        assert_eq!(tombstone_unlinked_files(&db, future).await.unwrap(), 2);
        assert_eq!(live_paths(&db).await, vec!["files/kept.txt".to_string()]);
    }

    #[tokio::test]
    async fn local_blobs_without_a_live_row_are_swept_after_the_grace_period() {
        let (db, dir) = test_db().await;
        let files_dir = dir.path().join("attachments/files");
        std::fs::create_dir_all(&files_dir).unwrap();
        file(&db, "files/live.txt").await;
        file(&db, "/var/mobile/Containers/x/files/ios.png").await;
        for name in ["live.txt", "ios.png", "orphan.txt"] {
            std::fs::write(files_dir.join(name), "x").unwrap();
        }

        let now = SystemTime::now();
        assert_eq!(
            sweep_local_blobs(&db, &files_dir, LOCAL_BLOB_GRACE, now)
                .await
                .unwrap(),
            0,
            "fresh blobs are kept"
        );
        let later = now + Duration::from_secs(2 * 60 * 60);
        assert_eq!(
            sweep_local_blobs(&db, &files_dir, LOCAL_BLOB_GRACE, later)
                .await
                .unwrap(),
            1
        );
        assert!(files_dir.join("live.txt").exists());
        assert!(files_dir.join("ios.png").exists());
        assert!(!files_dir.join("orphan.txt").exists());
    }
}
