use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{Assistant, CreateAssistantRequest, ModelParameterPreset};

impl Database {
    pub async fn create_assistant(&self, req: CreateAssistantRequest) -> Result<Assistant> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);
        let avatar_type = req.avatar_type.unwrap_or_else(|| "text".to_string());

        // If no preset ID provided, use the default preset
        let preset_id = if let Some(preset_id) = req.model_parameter_preset_id {
            Some(preset_id)
        } else {
            self.get_default_model_parameter_preset()
                .await?
                .map(|p| p.id)
        };

        sqlx::query(
            "INSERT INTO assistants (id, name, role, description, system_prompt, user_prompt, model_id, 
             model_parameter_preset_id, avatar_type, avatar_bg, avatar_text, avatar_image_path, 
             avatar_image_url, group_name, is_starred, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.role)
        .bind(&req.description)
        .bind(&req.system_prompt)
        .bind(&req.user_prompt)
        .bind(&req.model_id)
        .bind(&preset_id)
        .bind(&avatar_type)
        .bind(&req.avatar_bg)
        .bind(&req.avatar_text)
        .bind(&req.avatar_image_path)
        .bind(&req.avatar_image_url)
        .bind(&req.group_name)
        .bind(is_starred as i32)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        // Sync assistant_tools junction table
        if let Some(tool_ids) = &req.tool_ids {
            self.sync_assistant_tools(&id, tool_ids).await?;
        }

        // Sync assistant_skills junction table
        if let Some(skill_ids) = &req.skill_ids {
            self.sync_assistant_skills(&id, skill_ids).await?;
        }

        self.get_assistant(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created assistant"))
    }

    pub async fn get_assistant(&self, id: &str) -> Result<Option<Assistant>> {
        let row = sqlx::query(
            "SELECT a.id, a.name, a.role, a.description, a.system_prompt, a.user_prompt, a.model_id, 
             a.model_parameter_preset_id, a.avatar_type, a.avatar_bg, a.avatar_text, 
             a.avatar_image_path, a.avatar_image_url, a.group_name, a.is_starred, 
             a.created_at, a.updated_at,
             p.id as preset_id, p.name as preset_name, p.description as preset_description,
             p.temperature, p.max_tokens, p.top_p, p.frequency_penalty, p.presence_penalty,
             p.additional_params, p.is_system as preset_is_system, p.is_default as preset_is_default,
             p.created_at as preset_created_at, p.updated_at as preset_updated_at
             FROM assistants a
             LEFT JOIN model_parameter_presets p ON a.model_parameter_preset_id = p.id
             WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL AND a.id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => {
                let assistant_id: String = row.get("id");
                let is_starred: i32 = row.get("is_starred");
                let preset = Self::extract_preset_from_row(&row);

                // Load tool_ids and skill_ids from junction tables
                let tool_ids = self.get_assistant_tool_ids(&assistant_id).await?;
                let skill_ids = self.get_assistant_skill_ids(&assistant_id).await?;

                Ok(Some(Assistant {
                    id: assistant_id,
                    name: row.get("name"),
                    role: row.get("role"),
                    description: row.get("description"),
                    system_prompt: row.get("system_prompt"),
                    user_prompt: row.get("user_prompt"),
                    model_id: row.get("model_id"),
                    model_parameter_preset_id: row.get("model_parameter_preset_id"),
                    preset,
                    tool_ids,
                    skill_ids,
                    avatar_type: row.get("avatar_type"),
                    avatar_bg: row.get("avatar_bg"),
                    avatar_text: row.get("avatar_text"),
                    avatar_image_path: row.get("avatar_image_path"),
                    avatar_image_url: row.get("avatar_image_url"),
                    group_name: row.get("group_name"),
                    is_starred: is_starred != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn list_assistants(&self) -> Result<Vec<Assistant>> {
        let rows = sqlx::query(
            "SELECT a.id, a.name, a.role, a.description, a.system_prompt, a.user_prompt, a.model_id, 
             a.model_parameter_preset_id, a.avatar_type, a.avatar_bg, a.avatar_text, 
             a.avatar_image_path, a.avatar_image_url, a.group_name, a.is_starred, 
             a.created_at, a.updated_at,
             p.id as preset_id, p.name as preset_name, p.description as preset_description,
             p.temperature, p.max_tokens, p.top_p, p.frequency_penalty, p.presence_penalty,
             p.additional_params, p.is_system as preset_is_system, p.is_default as preset_is_default,
             p.created_at as preset_created_at, p.updated_at as preset_updated_at
             FROM assistants a
             LEFT JOIN model_parameter_presets p ON a.model_parameter_preset_id = p.id
             WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY a.created_at DESC",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        // Batch load all assistant tool_ids and skill_ids to avoid N+1 queries
        let all_tool_mappings = self.get_all_assistant_tool_ids().await?;
        let all_skill_mappings = self.get_all_assistant_skill_ids().await?;

        let assistants = rows
            .iter()
            .map(|row| {
                let assistant_id: String = row.get("id");
                let is_starred: i32 = row.get("is_starred");
                let preset = Self::extract_preset_from_row(row);

                // Get tool_ids and skill_ids for this assistant from the batch results
                let tool_ids = all_tool_mappings
                    .get(&assistant_id)
                    .cloned()
                    .unwrap_or_default();
                let skill_ids = all_skill_mappings
                    .get(&assistant_id)
                    .cloned()
                    .unwrap_or_default();

                Assistant {
                    id: assistant_id,
                    name: row.get("name"),
                    role: row.get("role"),
                    description: row.get("description"),
                    system_prompt: row.get("system_prompt"),
                    user_prompt: row.get("user_prompt"),
                    model_id: row.get("model_id"),
                    model_parameter_preset_id: row.get("model_parameter_preset_id"),
                    preset,
                    tool_ids,
                    skill_ids,
                    avatar_type: row.get("avatar_type"),
                    avatar_bg: row.get("avatar_bg"),
                    avatar_text: row.get("avatar_text"),
                    avatar_image_path: row.get("avatar_image_path"),
                    avatar_image_url: row.get("avatar_image_url"),
                    group_name: row.get("group_name"),
                    is_starred: is_starred != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();

        Ok(assistants)
    }

    pub async fn update_assistant(
        &self,
        id: &str,
        req: CreateAssistantRequest,
    ) -> Result<Assistant> {
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);
        let avatar_type = req.avatar_type.unwrap_or_else(|| "text".to_string());

        sqlx::query(
            "UPDATE assistants SET name = ?, role = ?, description = ?, system_prompt = ?, 
             user_prompt = ?, model_id = ?, model_parameter_preset_id = ?,
             avatar_type = ?, avatar_bg = ?, avatar_text = ?, 
             avatar_image_path = ?, avatar_image_url = ?, group_name = ?, 
             is_starred = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&req.name)
        .bind(&req.role)
        .bind(&req.description)
        .bind(&req.system_prompt)
        .bind(&req.user_prompt)
        .bind(&req.model_id)
        .bind(&req.model_parameter_preset_id)
        .bind(&avatar_type)
        .bind(&req.avatar_bg)
        .bind(&req.avatar_text)
        .bind(&req.avatar_image_path)
        .bind(&req.avatar_image_url)
        .bind(&req.group_name)
        .bind(is_starred as i32)
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        // Sync assistant_tools junction table
        if let Some(tool_ids) = &req.tool_ids {
            self.sync_assistant_tools(id, tool_ids).await?;
        }

        // Sync assistant_skills junction table
        if let Some(skill_ids) = &req.skill_ids {
            self.sync_assistant_skills(id, skill_ids).await?;
        }

        self.get_assistant(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Assistant not found"))
    }

    pub async fn delete_assistant(&self, id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        // Soft-delete the assistant and its junction rows explicitly - the
        // old FK-cascade trick no longer fires now that removal is a
        // tombstone update, and tombstones are what propagate via merge.
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "assistants",
            "id = ?2",
        ))
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        for table in ["assistant_tools", "assistant_skills"] {
            sqlx::query(&crate::db::soft_delete::tombstone_update(
                table,
                "assistant_id = ?2 AND deleted_at IS NULL",
            ))
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        }
        Ok(())
    }

    // ========================================================================
    // Assistant-Tool junction operations
    // ========================================================================

    /// Sync the assistant_tools junction table: tombstone existing
    /// associations and insert the requested ones as fresh rows.
    async fn sync_assistant_tools(&self, assistant_id: &str, tool_ids: &[String]) -> Result<()> {
        // Tombstone existing associations (soft-delete propagates via merge)
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "assistant_tools",
            "assistant_id = ?2 AND deleted_at IS NULL",
        ))
        .bind(Utc::now().to_rfc3339())
        .bind(assistant_id)
        .execute(self.pool.as_ref())
        .await?;

        // Insert new associations; a retained (assistant, tool) pair revives
        // its tombstoned row instead of violating the UNIQUE key.
        let now = Utc::now().to_rfc3339();
        for tool_id in tool_ids {
            let id = Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO assistant_tools (id, assistant_id, tool_id, created_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(assistant_id, tool_id)
                 DO UPDATE SET deleted_at = NULL, created_at = excluded.created_at",
            )
            .bind(&id)
            .bind(assistant_id)
            .bind(tool_id)
            .bind(&now)
            .execute(self.pool.as_ref())
            .await?;
        }

        Ok(())
    }

    /// Get tool IDs associated with an assistant
    pub async fn get_assistant_tool_ids(&self, assistant_id: &str) -> Result<Vec<String>> {
        let tool_ids = sqlx::query_scalar::<_, String>(
            "SELECT tool_id FROM assistant_tools WHERE assistant_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
        )
        .bind(assistant_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(tool_ids)
    }

    /// Batch load all assistant -> tool_id mappings (avoids N+1 in list_assistants)
    async fn get_all_assistant_tool_ids(
        &self,
    ) -> Result<std::collections::HashMap<String, Vec<String>>> {
        let rows = sqlx::query(
            "SELECT assistant_id, tool_id FROM assistant_tools WHERE deleted_at IS NULL ORDER BY created_at ASC",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row in rows {
            let assistant_id: String = row.get("assistant_id");
            let tool_id: String = row.get("tool_id");
            map.entry(assistant_id).or_default().push(tool_id);
        }

        Ok(map)
    }

    // ========================================================================
    // Helper: extract preset from joined row
    // ========================================================================

    fn extract_preset_from_row(row: &sqlx::sqlite::SqliteRow) -> Option<ModelParameterPreset> {
        let preset_id: Option<String> = row.get("preset_id");
        if preset_id.is_some() {
            let additional_params_str: Option<String> = row.get("additional_params");
            let additional_params =
                additional_params_str.and_then(|s| serde_json::from_str(&s).ok());

            Some(ModelParameterPreset {
                id: row.get("preset_id"),
                name: row.get("preset_name"),
                description: row.get("preset_description"),
                temperature: row.get("temperature"),
                max_tokens: row.get("max_tokens"),
                top_p: row.get("top_p"),
                frequency_penalty: row.get("frequency_penalty"),
                presence_penalty: row.get("presence_penalty"),
                additional_params,
                is_system: row.get::<i32, _>("preset_is_system") != 0,
                is_default: row.get::<i32, _>("preset_is_default") != 0,
                created_at: row.get("preset_created_at"),
                updated_at: row.get("preset_updated_at"),
            })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tools::{
        BUILTIN_BASH_ID, BUILTIN_GLOB_ID, BUILTIN_GREP_ID, BUILTIN_WEB_FETCH_ID,
    };
    use crate::models::{CreateModelRequest, CreateProviderRequest};

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    /// Create a real provider + model row so assistant FKs resolve.
    async fn make_model(db: &Database) -> String {
        let provider = db
            .create_provider(CreateProviderRequest {
                name: "Custom Provider".to_string(),
                provider_type: "custom".to_string(),
                api_key: None,
                base_url: None,
                api_style: None,
                description: None,
                is_enabled: None,
            })
            .await
            .unwrap();
        let model = db
            .create_model(CreateModelRequest {
                name: "Test Model".to_string(),
                provider_id: provider.id,
                model_id: "test-model".to_string(),
                description: None,
                is_starred: None,
            })
            .await
            .unwrap();
        model.id
    }

    fn assistant_req(model_id: &str) -> CreateAssistantRequest {
        CreateAssistantRequest {
            name: "Assistant".to_string(),
            role: None,
            description: None,
            system_prompt: "You help.".to_string(),
            user_prompt: None,
            model_id: model_id.to_string(),
            model_parameter_preset_id: None,
            tool_ids: None,
            skill_ids: None,
            avatar_type: None,
            avatar_bg: None,
            avatar_text: None,
            avatar_image_path: None,
            avatar_image_url: None,
            group_name: None,
            is_starred: None,
        }
    }

    fn sorted(mut v: Vec<String>) -> Vec<String> {
        v.sort();
        v
    }

    #[tokio::test]
    async fn create_assistant_round_trips_fields_and_tool_links() {
        let (db, _dir) = test_db().await;
        let model_id = make_model(&db).await;
        let created = db
            .create_assistant(CreateAssistantRequest {
                role: Some("Senior dev".to_string()),
                description: Some("Writes code".to_string()),
                user_prompt: Some("Code this".to_string()),
                tool_ids: Some(vec![
                    BUILTIN_WEB_FETCH_ID.to_string(),
                    BUILTIN_BASH_ID.to_string(),
                ]),
                avatar_type: Some("image".to_string()),
                avatar_bg: Some("#ff0000".to_string()),
                avatar_text: Some("C".to_string()),
                avatar_image_url: Some("https://example.com/a.png".to_string()),
                group_name: Some("Team".to_string()),
                is_starred: Some(true),
                ..assistant_req(&model_id)
            })
            .await
            .unwrap();

        assert_eq!(created.name, "Assistant");
        assert_eq!(created.role.as_deref(), Some("Senior dev"));
        assert_eq!(created.description.as_deref(), Some("Writes code"));
        assert_eq!(created.system_prompt, "You help.");
        assert_eq!(created.user_prompt.as_deref(), Some("Code this"));
        assert_eq!(created.model_id, model_id);
        assert_eq!(created.avatar_type, "image");
        assert_eq!(created.avatar_bg.as_deref(), Some("#ff0000"));
        assert_eq!(created.avatar_text.as_deref(), Some("C"));
        assert_eq!(
            created.avatar_image_url.as_deref(),
            Some("https://example.com/a.png")
        );
        assert_eq!(created.group_name.as_deref(), Some("Team"));
        assert!(created.is_starred);
        assert_eq!(
            sorted(created.tool_ids.clone()),
            vec![
                BUILTIN_BASH_ID.to_string(),
                BUILTIN_WEB_FETCH_ID.to_string()
            ]
        );
        assert!(created.skill_ids.is_empty());

        // No explicit preset in the request: the seeded default is attached.
        let default_preset = db
            .get_default_model_parameter_preset()
            .await
            .unwrap()
            .expect("default preset is seeded");
        assert_eq!(
            created.model_parameter_preset_id.as_deref(),
            Some(default_preset.id.as_str())
        );
        let preset = created.preset.expect("preset is joined in");
        assert_eq!(preset.id, default_preset.id);
        assert!(preset.is_default);

        let fetched = db.get_assistant(&created.id).await.unwrap().unwrap();
        assert_eq!(fetched.name, "Assistant");
        assert_eq!(
            sorted(fetched.tool_ids),
            vec![
                BUILTIN_BASH_ID.to_string(),
                BUILTIN_WEB_FETCH_ID.to_string()
            ]
        );
    }

    #[tokio::test]
    async fn create_assistant_applies_defaults_for_optional_fields() {
        let (db, _dir) = test_db().await;
        let model_id = make_model(&db).await;
        let created = db.create_assistant(assistant_req(&model_id)).await.unwrap();

        assert_eq!(created.avatar_type, "text", "avatar defaults to text");
        assert!(!created.is_starred, "starred defaults to false");
        assert!(created.role.is_none());
        assert!(created.tool_ids.is_empty());
        assert!(created.skill_ids.is_empty());
        assert!(
            created.model_parameter_preset_id.is_some(),
            "default preset is attached when none is requested"
        );
    }

    #[tokio::test]
    async fn get_assistant_missing_returns_none() {
        let (db, _dir) = test_db().await;
        assert!(db.get_assistant("no-such-id").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_assistant_changes_fields_and_preserves_tool_links() {
        let (db, _dir) = test_db().await;
        let model_id = make_model(&db).await;
        let created = db
            .create_assistant(CreateAssistantRequest {
                tool_ids: Some(vec![BUILTIN_WEB_FETCH_ID.to_string()]),
                is_starred: Some(true),
                ..assistant_req(&model_id)
            })
            .await
            .unwrap();

        let updated = db
            .update_assistant(
                &created.id,
                CreateAssistantRequest {
                    name: "Assistant v2".to_string(),
                    description: Some("New description".to_string()),
                    system_prompt: "New prompt".to_string(),
                    group_name: Some("Other Team".to_string()),
                    is_starred: Some(false),
                    // tool_ids absent -> junction rows are left untouched.
                    tool_ids: None,
                    ..assistant_req(&model_id)
                },
            )
            .await
            .unwrap();

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "Assistant v2");
        assert_eq!(updated.description.as_deref(), Some("New description"));
        assert_eq!(updated.system_prompt, "New prompt");
        assert_eq!(updated.group_name.as_deref(), Some("Other Team"));
        assert!(!updated.is_starred);
        assert_eq!(
            updated.avatar_type, "text",
            "avatar default applies on update"
        );
        assert_eq!(
            updated.tool_ids,
            vec![BUILTIN_WEB_FETCH_ID.to_string()],
            "absent tool_ids must not unlink tools"
        );
        // Unlike create, update does not fall back to the default preset.
        assert_eq!(updated.model_parameter_preset_id, None);
        assert!(updated.preset.is_none());
    }

    #[tokio::test]
    async fn update_assistant_resyncs_tool_links() {
        let (db, _dir) = test_db().await;
        let model_id = make_model(&db).await;
        let created = db
            .create_assistant(CreateAssistantRequest {
                tool_ids: Some(vec![BUILTIN_WEB_FETCH_ID.to_string()]),
                ..assistant_req(&model_id)
            })
            .await
            .unwrap();

        let updated = db
            .update_assistant(
                &created.id,
                CreateAssistantRequest {
                    tool_ids: Some(vec![
                        BUILTIN_GREP_ID.to_string(),
                        BUILTIN_GLOB_ID.to_string(),
                    ]),
                    ..assistant_req(&model_id)
                },
            )
            .await
            .unwrap();
        // The junction read filters tombstones, so the response reports
        // exactly the freshly synced tools.
        assert_eq!(
            sorted(updated.tool_ids),
            vec![BUILTIN_GLOB_ID.to_string(), BUILTIN_GREP_ID.to_string()]
        );

        // The live junction rows now point at the new tools only.
        let live: Vec<String> = sqlx::query_scalar(
            "SELECT tool_id FROM assistant_tools WHERE assistant_id = ? AND deleted_at IS NULL",
        )
        .bind(&created.id)
        .fetch_all(db.pool())
        .await
        .unwrap();
        assert_eq!(
            sorted(live),
            vec![BUILTIN_GLOB_ID.to_string(), BUILTIN_GREP_ID.to_string()]
        );
    }

    #[tokio::test]
    async fn update_assistant_retaining_tool_link_succeeds() {
        let (db, _dir) = test_db().await;
        let model_id = make_model(&db).await;
        let created = db
            .create_assistant(CreateAssistantRequest {
                tool_ids: Some(vec![BUILTIN_WEB_FETCH_ID.to_string()]),
                ..assistant_req(&model_id)
            })
            .await
            .unwrap();

        // Retaining web_fetch while adding grep must not hit
        // UNIQUE(assistant_id, tool_id): the retained pair revives its
        // tombstoned junction row.
        let updated = db
            .update_assistant(
                &created.id,
                CreateAssistantRequest {
                    tool_ids: Some(vec![
                        BUILTIN_WEB_FETCH_ID.to_string(),
                        BUILTIN_GREP_ID.to_string(),
                    ]),
                    ..assistant_req(&model_id)
                },
            )
            .await
            .unwrap();
        assert_eq!(
            sorted(updated.tool_ids),
            vec![
                BUILTIN_GREP_ID.to_string(),
                BUILTIN_WEB_FETCH_ID.to_string()
            ]
        );
    }

    #[tokio::test]
    async fn get_assistant_tool_ids_returns_linked_tools_only() {
        let (db, _dir) = test_db().await;
        let model_id = make_model(&db).await;
        assert!(
            db.get_assistant_tool_ids("no-such-assistant")
                .await
                .unwrap()
                .is_empty()
        );

        let created = db
            .create_assistant(CreateAssistantRequest {
                tool_ids: Some(vec![
                    BUILTIN_WEB_FETCH_ID.to_string(),
                    BUILTIN_GREP_ID.to_string(),
                ]),
                ..assistant_req(&model_id)
            })
            .await
            .unwrap();
        let tool_ids = db.get_assistant_tool_ids(&created.id).await.unwrap();
        assert_eq!(
            sorted(tool_ids),
            vec![
                BUILTIN_GREP_ID.to_string(),
                BUILTIN_WEB_FETCH_ID.to_string()
            ]
        );
    }

    #[tokio::test]
    async fn delete_assistant_hides_row_and_tombstones_tool_links() {
        let (db, _dir) = test_db().await;
        let model_id = make_model(&db).await;
        let created = db
            .create_assistant(CreateAssistantRequest {
                tool_ids: Some(vec![BUILTIN_WEB_FETCH_ID.to_string()]),
                ..assistant_req(&model_id)
            })
            .await
            .unwrap();
        let other = db.create_assistant(assistant_req(&model_id)).await.unwrap();

        db.delete_assistant(&created.id).await.unwrap();

        assert!(db.get_assistant(&created.id).await.unwrap().is_none());
        let listed: Vec<String> = db
            .list_assistants()
            .await
            .unwrap()
            .into_iter()
            .map(|a| a.id)
            .collect();
        assert!(!listed.contains(&created.id));
        assert!(listed.contains(&other.id), "other assistants survive");

        let assistant_tombstone: Option<String> =
            sqlx::query_scalar("SELECT deleted_at FROM assistants WHERE id = ?")
                .bind(&created.id)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert!(assistant_tombstone.is_some());
        let live_links: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM assistant_tools WHERE assistant_id = ? AND deleted_at IS NULL",
        )
        .bind(&created.id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(live_links, 0, "junction rows are tombstoned too");
    }

    #[tokio::test]
    async fn list_assistants_orders_newest_first() {
        let (db, _dir) = test_db().await;
        let model_id = make_model(&db).await;
        for name in ["oldest", "middle", "newest"] {
            let mut req = assistant_req(&model_id);
            req.name = name.to_string();
            db.create_assistant(req).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(3)).await;
        }
        let names: Vec<String> = db
            .list_assistants()
            .await
            .unwrap()
            .into_iter()
            .map(|a| a.name)
            .collect();
        assert_eq!(names, vec!["newest", "middle", "oldest"]);
    }
}
