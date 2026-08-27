use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_model_parameter_presets_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS model_parameter_presets (
            id TEXT PRIMARY KEY,
            -- UNIQUE(name) is REQUIRED as the tnk merge conflict target
            -- (natural-key twin loses, local row keeps its id). System
            -- presets use deterministic UUID-v5 ids so every device seeds
            -- the SAME rows and the pk conflict path (whole-row LWW) wins
            -- over the name path — no identity split.
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
