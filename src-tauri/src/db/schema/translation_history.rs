use anyhow::Result;
use sqlx::SqlitePool;

/// Translation history, created in the device-local database: it never
/// enters the sync snapshot and is never merged across devices.
pub async fn create_translation_history_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS translation_history (
            id TEXT PRIMARY KEY,
            source_text TEXT NOT NULL,
            translated_text TEXT NOT NULL,
            source_language TEXT NOT NULL,
            target_language TEXT NOT NULL,
            model_id TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (source_text, source_language, target_language)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_translation_history_created_at
         ON translation_history (created_at DESC)",
    )
    .execute(pool)
    .await?;

    Ok(())
}
