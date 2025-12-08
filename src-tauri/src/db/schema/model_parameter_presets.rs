use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_model_parameter_presets_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS model_parameter_presets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            temperature REAL,
            max_tokens INTEGER,
            top_p REAL,
            frequency_penalty REAL,
            presence_penalty REAL,
            additional_params TEXT,
            is_system INTEGER DEFAULT 0,
            is_default INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    Ok(())
}

