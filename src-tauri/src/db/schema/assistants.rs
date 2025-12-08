use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_assistants_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS assistants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT,
            description TEXT,
            system_prompt TEXT NOT NULL,
            user_prompt TEXT,
            model_id TEXT NOT NULL,
            model_parameter_preset_id TEXT,
            avatar_type TEXT DEFAULT 'text',
            avatar_bg TEXT,
            avatar_text TEXT,
            avatar_image_path TEXT,
            avatar_image_url TEXT,
            group_name TEXT,
            is_starred INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (model_id) REFERENCES models(id),
            FOREIGN KEY (model_parameter_preset_id) REFERENCES model_parameter_presets(id)
        )",
    )
    .execute(pool)
    .await?;

    Ok(())
}
