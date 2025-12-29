use anyhow::Result;
use sqlx::Row;

use super::Database;
use crate::models::{ConversationSettings, PromptMode, UpdateConversationSettingsRequest};

impl Database {
    /// Get settings for a conversation. Returns default settings if none exist.
    pub async fn get_conversation_settings(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationSettings> {
        let row = sqlx::query(
            "SELECT conversation_id, use_provider_defaults, use_custom_parameters,
             parameter_overrides, context_message_count, selected_preset_id,
             system_prompt_mode, selected_system_prompt_id, custom_system_prompt,
             user_prompt_mode, selected_user_prompt_id, custom_user_prompt,
             enabled_mcp_server_ids
             FROM conversation_settings WHERE conversation_id = ?",
        )
        .bind(conversation_id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(self.row_to_conversation_settings(&row)),
            None => {
                // Return default settings if none exist
                Ok(ConversationSettings::default_for_conversation(
                    conversation_id.to_string(),
                ))
            }
        }
    }

    /// Update settings for a conversation. Creates settings if they don't exist (upsert).
    pub async fn update_conversation_settings(
        &self,
        conversation_id: &str,
        req: UpdateConversationSettingsRequest,
    ) -> Result<ConversationSettings> {
        // Get existing settings or defaults
        let existing = self.get_conversation_settings(conversation_id).await?;

        // Merge updates
        let use_provider_defaults = req
            .use_provider_defaults
            .unwrap_or(existing.use_provider_defaults);
        let use_custom_parameters = req
            .use_custom_parameters
            .unwrap_or(existing.use_custom_parameters);
        let parameter_overrides = req
            .parameter_overrides
            .unwrap_or(existing.parameter_overrides);
        let context_message_count = req
            .context_message_count
            .unwrap_or(existing.context_message_count);
        let selected_preset_id = req
            .selected_preset_id
            .unwrap_or(existing.selected_preset_id);
        let system_prompt_mode = req
            .system_prompt_mode
            .unwrap_or(existing.system_prompt_mode);
        let selected_system_prompt_id = req
            .selected_system_prompt_id
            .unwrap_or(existing.selected_system_prompt_id);
        let custom_system_prompt = req
            .custom_system_prompt
            .unwrap_or(existing.custom_system_prompt);
        let user_prompt_mode = req.user_prompt_mode.unwrap_or(existing.user_prompt_mode);
        let selected_user_prompt_id = req
            .selected_user_prompt_id
            .unwrap_or(existing.selected_user_prompt_id);
        let custom_user_prompt = req
            .custom_user_prompt
            .unwrap_or(existing.custom_user_prompt);
        let enabled_mcp_server_ids = req
            .enabled_mcp_server_ids
            .unwrap_or(existing.enabled_mcp_server_ids);

        // Serialize parameter overrides to JSON
        let parameter_overrides_json = serde_json::to_string(&parameter_overrides)?;
        // Serialize enabled MCP server IDs to JSON
        let enabled_mcp_server_ids_json = serde_json::to_string(&enabled_mcp_server_ids)?;

        // Upsert
        sqlx::query(
            "INSERT INTO conversation_settings (
                conversation_id, use_provider_defaults, use_custom_parameters,
                parameter_overrides, context_message_count, selected_preset_id,
                system_prompt_mode, selected_system_prompt_id, custom_system_prompt,
                user_prompt_mode, selected_user_prompt_id, custom_user_prompt,
                enabled_mcp_server_ids
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                use_provider_defaults = excluded.use_provider_defaults,
                use_custom_parameters = excluded.use_custom_parameters,
                parameter_overrides = excluded.parameter_overrides,
                context_message_count = excluded.context_message_count,
                selected_preset_id = excluded.selected_preset_id,
                system_prompt_mode = excluded.system_prompt_mode,
                selected_system_prompt_id = excluded.selected_system_prompt_id,
                custom_system_prompt = excluded.custom_system_prompt,
                user_prompt_mode = excluded.user_prompt_mode,
                selected_user_prompt_id = excluded.selected_user_prompt_id,
                custom_user_prompt = excluded.custom_user_prompt,
                enabled_mcp_server_ids = excluded.enabled_mcp_server_ids",
        )
        .bind(conversation_id)
        .bind(use_provider_defaults as i32)
        .bind(use_custom_parameters as i32)
        .bind(&parameter_overrides_json)
        .bind(context_message_count)
        .bind(&selected_preset_id)
        .bind(String::from(system_prompt_mode.clone()))
        .bind(&selected_system_prompt_id)
        .bind(&custom_system_prompt)
        .bind(String::from(user_prompt_mode.clone()))
        .bind(&selected_user_prompt_id)
        .bind(&custom_user_prompt)
        .bind(&enabled_mcp_server_ids_json)
        .execute(self.pool.as_ref())
        .await?;

        self.get_conversation_settings(conversation_id).await
    }

    /// Delete settings for a conversation
    pub async fn delete_conversation_settings(&self, conversation_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM conversation_settings WHERE conversation_id = ?")
            .bind(conversation_id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    fn row_to_conversation_settings(&self, row: &sqlx::sqlite::SqliteRow) -> ConversationSettings {
        let use_provider_defaults: i32 = row.get("use_provider_defaults");
        let use_custom_parameters: i32 = row.get("use_custom_parameters");
        let parameter_overrides_json: Option<String> = row.get("parameter_overrides");
        let system_prompt_mode_str: String = row.get("system_prompt_mode");
        let user_prompt_mode_str: String = row.get("user_prompt_mode");
        let enabled_mcp_server_ids_json: Option<String> = row.get("enabled_mcp_server_ids");

        let parameter_overrides = parameter_overrides_json
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();

        let enabled_mcp_server_ids = enabled_mcp_server_ids_json
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();

        ConversationSettings {
            conversation_id: row.get("conversation_id"),
            use_provider_defaults: use_provider_defaults != 0,
            use_custom_parameters: use_custom_parameters != 0,
            parameter_overrides,
            context_message_count: row.get("context_message_count"),
            selected_preset_id: row.get("selected_preset_id"),
            system_prompt_mode: PromptMode::from(system_prompt_mode_str.as_str()),
            selected_system_prompt_id: row.get("selected_system_prompt_id"),
            custom_system_prompt: row.get("custom_system_prompt"),
            user_prompt_mode: PromptMode::from(user_prompt_mode_str.as_str()),
            selected_user_prompt_id: row.get("selected_user_prompt_id"),
            custom_user_prompt: row.get("custom_user_prompt"),
            enabled_mcp_server_ids,
        }
    }
}
