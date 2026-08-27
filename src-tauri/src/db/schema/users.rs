use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_users_table(pool: &SqlitePool) -> Result<()> {
    // Users table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            email TEXT UNIQUE,
            avatar_type TEXT DEFAULT 'text',
            avatar_bg TEXT,
            avatar_text TEXT,
            avatar_image_path TEXT,
            avatar_image_url TEXT,
            is_self INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            last_seen_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    Ok(())
}
