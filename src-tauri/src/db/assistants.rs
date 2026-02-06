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
             WHERE a.id = ?",
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
             ORDER BY a.created_at DESC",
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
        // assistant_tools and assistant_skills are cascade-deleted via FK constraint
        sqlx::query("DELETE FROM assistants WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // ========================================================================
    // Assistant-Tool junction operations
    // ========================================================================

    /// Sync the assistant_tools junction table: delete all existing and insert new ones
    async fn sync_assistant_tools(&self, assistant_id: &str, tool_ids: &[String]) -> Result<()> {
        // Delete existing associations
        sqlx::query("DELETE FROM assistant_tools WHERE assistant_id = ?")
            .bind(assistant_id)
            .execute(self.pool.as_ref())
            .await?;

        // Insert new associations
        let now = Utc::now().to_rfc3339();
        for tool_id in tool_ids {
            let id = Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO assistant_tools (id, assistant_id, tool_id, created_at)
                 VALUES (?, ?, ?, ?)",
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
            "SELECT tool_id FROM assistant_tools WHERE assistant_id = ? ORDER BY created_at ASC",
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
            "SELECT assistant_id, tool_id FROM assistant_tools ORDER BY created_at ASC",
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
