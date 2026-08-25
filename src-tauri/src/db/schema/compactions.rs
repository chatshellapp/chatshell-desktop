use anyhow::Result;
use sqlx::SqlitePool;

/// `compactions` (schema v12): one row per context-compaction event. The
/// LLM context rebuild replaces everything before `first_kept_message_id`
/// with the summary message (soft) or the archive frames (snapcompact);
/// display history is untouched — only the projection shrinks.
///
/// Sync: mutable table (rows are tombstoned when a fork rewinds), registered
/// in the core merge registry.
pub async fn create_compactions_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS compactions (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id),
            summary TEXT NOT NULL DEFAULT '',
            first_kept_message_id TEXT NOT NULL,
            tokens_before INTEGER NOT NULL DEFAULT 0,
            method TEXT NOT NULL DEFAULT 'soft',
            archive_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT '',
            deleted_at TEXT
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_compactions_conversation
         ON compactions(conversation_id)",
    )
    .execute(pool)
    .await?;

    Ok(())
}
