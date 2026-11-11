use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_prompts_table(pool: &SqlitePool) -> Result<()> {
    // Prompts table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS prompts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            description TEXT,
            category TEXT,
            is_system INTEGER DEFAULT 0,
            is_starred INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    // Add is_starred column if it doesn't exist (migration)
    sqlx::query("ALTER TABLE prompts ADD COLUMN is_starred INTEGER DEFAULT 0")
        .execute(pool)
        .await
        .ok(); // Ignore errors if column already exists

    Ok(())
}
