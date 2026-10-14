use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_prompt_history_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS prompt_history (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    Ok(())
}
