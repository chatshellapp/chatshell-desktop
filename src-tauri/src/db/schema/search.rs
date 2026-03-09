use anyhow::Result;
use sqlx::SqlitePool;

/// FTS5 virtual table for message content search.
/// Content column holds jieba-tokenized text (space-separated); message_id and
/// conversation_id are UNINDEXED and used only for JOINs.
pub async fn create_messages_fts_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content,
            message_id UNINDEXED,
            conversation_id UNINDEXED,
            tokenize='unicode61'
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}
