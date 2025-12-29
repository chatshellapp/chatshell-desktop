use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_conversation_settings_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversation_settings (
            conversation_id TEXT PRIMARY KEY,
            use_provider_defaults INTEGER DEFAULT 1,
            use_custom_parameters INTEGER DEFAULT 0,
            parameter_overrides TEXT,
            context_message_count INTEGER,
            selected_preset_id TEXT,
            system_prompt_mode TEXT DEFAULT 'none',
            selected_system_prompt_id TEXT,
            custom_system_prompt TEXT,
            user_prompt_mode TEXT DEFAULT 'none',
            selected_user_prompt_id TEXT,
            custom_user_prompt TEXT,
            enabled_mcp_server_ids TEXT,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (selected_preset_id) REFERENCES model_parameter_presets(id) ON DELETE SET NULL,
            FOREIGN KEY (selected_system_prompt_id) REFERENCES prompts(id) ON DELETE SET NULL,
            FOREIGN KEY (selected_user_prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
        )",
    )
    .execute(pool)
    .await?;

    Ok(())
}
