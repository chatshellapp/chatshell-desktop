use anyhow::Result;
use chrono::Utc;
use sqlx::Row;

use super::Database;
use crate::models::{
    ConversationSettings, ModelParameterOverrides, PromptMode, UpdateConversationSettingsRequest,
};

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
             enabled_mcp_server_ids, enabled_skill_ids, working_directory
             FROM conversation_settings WHERE conversation_id = ? AND deleted_at IS NULL",
        )
        .bind(conversation_id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(self.row_to_conversation_settings(&row)),
            None => {
                // Return default settings if none exist, inheriting globally enabled tools
                // This includes both MCP servers and builtin tools
                let mut enabled_tool_ids: Vec<String> = Vec::new();

                // Add enabled MCP servers
                let mcp_tools = self.list_enabled_tools_by_type("mcp").await?;
                enabled_tool_ids.extend(mcp_tools.into_iter().map(|tool| tool.id));

                // Add enabled builtin tools
                let builtin_tools = self.list_enabled_tools_by_type("builtin").await?;
                enabled_tool_ids.extend(builtin_tools.into_iter().map(|tool| tool.id));

                // Add globally enabled skills
                let all_skills = self.list_skills().await?;
                let enabled_skill_ids: Vec<String> = all_skills
                    .into_iter()
                    .filter(|s| s.is_enabled)
                    .map(|s| s.id)
                    .collect();

                Ok(ConversationSettings {
                    conversation_id: conversation_id.to_string(),
                    use_provider_defaults: true,
                    use_custom_parameters: false,
                    parameter_overrides: ModelParameterOverrides::default(),
                    context_message_count: None,
                    selected_preset_id: None,
                    system_prompt_mode: PromptMode::None,
                    selected_system_prompt_id: None,
                    custom_system_prompt: None,
                    user_prompt_mode: PromptMode::None,
                    selected_user_prompt_id: None,
                    custom_user_prompt: None,
                    enabled_mcp_server_ids: enabled_tool_ids,
                    enabled_skill_ids,
                    working_directory: None,
                })
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
        let enabled_skill_ids = req.enabled_skill_ids.unwrap_or(existing.enabled_skill_ids);
        let working_directory = req.working_directory.unwrap_or(existing.working_directory);

        // Serialize parameter overrides to JSON
        let parameter_overrides_json = serde_json::to_string(&parameter_overrides)?;
        // Serialize enabled MCP server IDs to JSON
        let enabled_mcp_server_ids_json = serde_json::to_string(&enabled_mcp_server_ids)?;
        // Serialize enabled skill IDs to JSON
        let enabled_skill_ids_json = serde_json::to_string(&enabled_skill_ids)?;

        // Upsert
        sqlx::query(
            "INSERT INTO conversation_settings (
                conversation_id, use_provider_defaults, use_custom_parameters,
                parameter_overrides, context_message_count, selected_preset_id,
                system_prompt_mode, selected_system_prompt_id, custom_system_prompt,
                user_prompt_mode, selected_user_prompt_id, custom_user_prompt,
                enabled_mcp_server_ids, enabled_skill_ids, working_directory, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                deleted_at = NULL,
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
                enabled_mcp_server_ids = excluded.enabled_mcp_server_ids,
                enabled_skill_ids = excluded.enabled_skill_ids,
                working_directory = excluded.working_directory,
                updated_at = excluded.updated_at",
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
        .bind(&enabled_skill_ids_json)
        .bind(&working_directory)
        .bind(Utc::now().to_rfc3339())
        .execute(self.pool.as_ref())
        .await?;

        self.get_conversation_settings(conversation_id).await
    }

    /// Reset only the tools and skills in conversation settings to global defaults.
    /// Preserves all other settings (system prompt, parameters, etc.).
    pub async fn reset_tools_and_skills_to_global(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationSettings> {
        let mut enabled_tool_ids: Vec<String> = Vec::new();
        let mcp_tools = self.list_enabled_tools_by_type("mcp").await?;
        enabled_tool_ids.extend(mcp_tools.into_iter().map(|tool| tool.id));
        let builtin_tools = self.list_enabled_tools_by_type("builtin").await?;
        enabled_tool_ids.extend(builtin_tools.into_iter().map(|tool| tool.id));

        let all_skills = self.list_skills().await?;
        let enabled_skill_ids: Vec<String> = all_skills
            .into_iter()
            .filter(|s| s.is_enabled)
            .map(|s| s.id)
            .collect();

        self.update_conversation_settings(
            conversation_id,
            UpdateConversationSettingsRequest {
                enabled_mcp_server_ids: Some(enabled_tool_ids),
                enabled_skill_ids: Some(enabled_skill_ids),
                ..Default::default()
            },
        )
        .await
    }

    /// Delete settings for a conversation
    pub async fn delete_conversation_settings(&self, conversation_id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "conversation_settings",
            "conversation_id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
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
        let enabled_skill_ids_json: Option<String> = row.get("enabled_skill_ids");

        let parameter_overrides = parameter_overrides_json
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();

        let enabled_mcp_server_ids = enabled_mcp_server_ids_json
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();

        let enabled_skill_ids = enabled_skill_ids_json
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
            enabled_skill_ids,
            working_directory: row.get("working_directory"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateConversationRequest, CreatePromptRequest};

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    async fn new_conversation(db: &Database) -> String {
        db.create_conversation(CreateConversationRequest {
            title: "Test conversation".to_string(),
        })
        .await
        .unwrap()
        .id
    }

    /// The tool ids the default path inherits: enabled MCP servers plus
    /// enabled builtin tools, in the order the implementation collects them.
    async fn global_tool_ids(db: &Database) -> Vec<String> {
        let mut ids: Vec<String> = db
            .list_enabled_tools_by_type("mcp")
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        ids.extend(
            db.list_enabled_tools_by_type("builtin")
                .await
                .unwrap()
                .into_iter()
                .map(|t| t.id),
        );
        ids
    }

    #[tokio::test]
    async fn get_returns_global_defaults_when_no_row_exists() {
        let (db, _dir) = test_db().await;
        let conversation_id = new_conversation(&db).await;

        let settings = db
            .get_conversation_settings(&conversation_id)
            .await
            .unwrap();
        assert_eq!(settings.conversation_id, conversation_id);
        assert!(settings.use_provider_defaults);
        assert!(!settings.use_custom_parameters);
        assert_eq!(settings.parameter_overrides.temperature, None);
        assert_eq!(settings.parameter_overrides.max_tokens, None);
        assert_eq!(settings.parameter_overrides.top_p, None);
        assert_eq!(settings.parameter_overrides.frequency_penalty, None);
        assert_eq!(settings.parameter_overrides.presence_penalty, None);
        assert_eq!(settings.context_message_count, None);
        assert_eq!(settings.selected_preset_id, None);
        assert_eq!(settings.system_prompt_mode, PromptMode::None);
        assert_eq!(settings.selected_system_prompt_id, None);
        assert_eq!(settings.custom_system_prompt, None);
        assert_eq!(settings.user_prompt_mode, PromptMode::None);
        assert_eq!(settings.selected_user_prompt_id, None);
        assert_eq!(settings.custom_user_prompt, None);
        assert_eq!(settings.working_directory, None);
        // Inherits globally enabled tools (builtin tools are seeded enabled)
        assert_eq!(settings.enabled_mcp_server_ids, global_tool_ids(&db).await);
        assert!(!settings.enabled_mcp_server_ids.is_empty());
        // No skills are seeded
        assert!(settings.enabled_skill_ids.is_empty());
    }

    #[tokio::test]
    async fn update_creates_and_round_trips_all_fields() {
        let (db, _dir) = test_db().await;
        let conversation_id = new_conversation(&db).await;
        let preset_id = db
            .get_default_model_parameter_preset()
            .await
            .unwrap()
            .unwrap()
            .id;
        let prompt = db
            .create_prompt(CreatePromptRequest {
                name: "User Prompt".to_string(),
                content: "Answer concisely".to_string(),
                description: None,
                category: None,
                is_system: Some(false),
            })
            .await
            .unwrap();

        let saved = db
            .update_conversation_settings(
                &conversation_id,
                UpdateConversationSettingsRequest {
                    use_provider_defaults: Some(false),
                    use_custom_parameters: Some(true),
                    parameter_overrides: Some(ModelParameterOverrides {
                        temperature: Some(0.2),
                        max_tokens: Some(512),
                        top_p: Some(0.9),
                        frequency_penalty: Some(0.0),
                        presence_penalty: Some(0.1),
                    }),
                    context_message_count: Some(Some(50)),
                    selected_preset_id: Some(Some(preset_id.clone())),
                    system_prompt_mode: Some(PromptMode::Custom),
                    selected_system_prompt_id: None,
                    custom_system_prompt: Some(Some("Custom system prompt".to_string())),
                    user_prompt_mode: Some(PromptMode::Existing),
                    selected_user_prompt_id: Some(Some(prompt.id.clone())),
                    custom_user_prompt: None,
                    enabled_mcp_server_ids: Some(vec!["tool-a".to_string(), "tool-b".to_string()]),
                    enabled_skill_ids: Some(vec!["skill-1".to_string()]),
                    working_directory: Some(Some("/tmp/chatshell".to_string())),
                },
            )
            .await
            .unwrap();
        assert_eq!(saved.conversation_id, conversation_id);

        // Read back through a fresh query: JSON columns are re-parsed
        let settings = db
            .get_conversation_settings(&conversation_id)
            .await
            .unwrap();
        assert!(!settings.use_provider_defaults);
        assert!(settings.use_custom_parameters);
        assert_eq!(settings.parameter_overrides.temperature, Some(0.2));
        assert_eq!(settings.parameter_overrides.max_tokens, Some(512));
        assert_eq!(settings.parameter_overrides.top_p, Some(0.9));
        assert_eq!(settings.parameter_overrides.frequency_penalty, Some(0.0));
        assert_eq!(settings.parameter_overrides.presence_penalty, Some(0.1));
        assert_eq!(settings.context_message_count, Some(50));
        assert_eq!(
            settings.selected_preset_id.as_deref(),
            Some(preset_id.as_str())
        );
        assert_eq!(settings.system_prompt_mode, PromptMode::Custom);
        assert_eq!(
            settings.custom_system_prompt.as_deref(),
            Some("Custom system prompt")
        );
        assert_eq!(settings.user_prompt_mode, PromptMode::Existing);
        assert_eq!(
            settings.selected_user_prompt_id.as_deref(),
            Some(prompt.id.as_str())
        );
        assert_eq!(
            settings.enabled_mcp_server_ids,
            vec!["tool-a".to_string(), "tool-b".to_string()]
        );
        assert_eq!(settings.enabled_skill_ids, vec!["skill-1".to_string()]);
        assert_eq!(
            settings.working_directory.as_deref(),
            Some("/tmp/chatshell")
        );
    }

    #[tokio::test]
    async fn partial_update_preserves_untouched_fields() {
        let (db, _dir) = test_db().await;
        let conversation_id = new_conversation(&db).await;

        db.update_conversation_settings(
            &conversation_id,
            UpdateConversationSettingsRequest {
                use_custom_parameters: Some(true),
                context_message_count: Some(Some(20)),
                custom_system_prompt: Some(Some("Keep me".to_string())),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let settings = db
            .update_conversation_settings(
                &conversation_id,
                UpdateConversationSettingsRequest {
                    enabled_mcp_server_ids: Some(vec!["only-tool".to_string()]),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        // Only the tool list changed; the rest merged from the stored row
        assert_eq!(
            settings.enabled_mcp_server_ids,
            vec!["only-tool".to_string()]
        );
        assert!(settings.use_custom_parameters);
        assert_eq!(settings.context_message_count, Some(20));
        assert_eq!(settings.custom_system_prompt.as_deref(), Some("Keep me"));
    }

    #[tokio::test]
    async fn explicit_null_clears_stored_values() {
        let (db, _dir) = test_db().await;
        let conversation_id = new_conversation(&db).await;

        db.update_conversation_settings(
            &conversation_id,
            UpdateConversationSettingsRequest {
                context_message_count: Some(Some(20)),
                working_directory: Some(Some("/tmp/old".to_string())),
                custom_user_prompt: Some(Some("old".to_string())),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let settings = db
            .update_conversation_settings(
                &conversation_id,
                UpdateConversationSettingsRequest {
                    context_message_count: Some(None),
                    working_directory: Some(None),
                    custom_user_prompt: Some(None),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        assert_eq!(settings.context_message_count, None);
        assert_eq!(settings.working_directory, None);
        assert_eq!(settings.custom_user_prompt, None);
    }

    #[tokio::test]
    async fn reset_tools_and_skills_restores_global_and_keeps_other_settings() {
        let (db, _dir) = test_db().await;
        let conversation_id = new_conversation(&db).await;

        db.update_conversation_settings(
            &conversation_id,
            UpdateConversationSettingsRequest {
                use_custom_parameters: Some(true),
                custom_system_prompt: Some(Some("Preserved prompt".to_string())),
                enabled_mcp_server_ids: Some(vec!["custom-tool".to_string()]),
                enabled_skill_ids: Some(vec!["custom-skill".to_string()]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let settings = db
            .reset_tools_and_skills_to_global(&conversation_id)
            .await
            .unwrap();

        assert_eq!(settings.enabled_mcp_server_ids, global_tool_ids(&db).await);
        assert!(settings.enabled_skill_ids.is_empty());
        // Everything outside tools and skills is untouched by the reset
        assert!(settings.use_custom_parameters);
        assert_eq!(
            settings.custom_system_prompt.as_deref(),
            Some("Preserved prompt")
        );
    }

    #[tokio::test]
    async fn reset_without_existing_row_starts_from_defaults() {
        let (db, _dir) = test_db().await;
        let conversation_id = new_conversation(&db).await;

        let settings = db
            .reset_tools_and_skills_to_global(&conversation_id)
            .await
            .unwrap();
        assert_eq!(settings.conversation_id, conversation_id);
        assert_eq!(settings.enabled_mcp_server_ids, global_tool_ids(&db).await);
        // Fields the reset does not touch fall back to the defaults path
        assert!(settings.use_provider_defaults);
    }

    #[tokio::test]
    async fn delete_tombstones_row_and_upsert_revives_it() {
        let (db, _dir) = test_db().await;
        let conversation_id = new_conversation(&db).await;

        db.update_conversation_settings(
            &conversation_id,
            UpdateConversationSettingsRequest {
                context_message_count: Some(Some(10)),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        db.delete_conversation_settings(&conversation_id)
            .await
            .unwrap();

        let deleted_at: Option<String> = sqlx::query_scalar(
            "SELECT deleted_at FROM conversation_settings WHERE conversation_id = ?",
        )
        .bind(&conversation_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert!(
            deleted_at.is_some(),
            "row must be tombstoned, not hard-deleted"
        );

        // Reads filter tombstones, so a deleted settings row falls back to
        // the computed defaults instead of the wiped payload.
        let defaults = db
            .get_conversation_settings(&conversation_id)
            .await
            .unwrap();
        assert!(defaults.use_provider_defaults);
        assert_eq!(defaults.context_message_count, None);
        assert!(
            !defaults.enabled_mcp_server_ids.is_empty(),
            "defaults inherit the seeded builtin tools"
        );
        assert_eq!(defaults.enabled_skill_ids, Vec::<String>::new());

        // The upsert overwrites the tombstone and the row reads normally again
        let revived = db
            .update_conversation_settings(
                &conversation_id,
                UpdateConversationSettingsRequest {
                    context_message_count: Some(Some(30)),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(revived.context_message_count, Some(30));
    }

    #[tokio::test]
    async fn delete_missing_settings_is_ok() {
        let (db, _dir) = test_db().await;
        let conversation_id = new_conversation(&db).await;
        // No settings row was ever written for this conversation
        db.delete_conversation_settings(&conversation_id)
            .await
            .unwrap();
    }
}
