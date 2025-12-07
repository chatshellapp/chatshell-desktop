use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{Assistant, CreateAssistantRequest, ModelParameters};

impl Database {
    pub async fn create_assistant(&self, req: CreateAssistantRequest) -> Result<Assistant> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);
        let avatar_type = req.avatar_type.unwrap_or_else(|| "text".to_string());

        // Extract model parameters
        let model_params = req.model_params.unwrap_or_default();
        let additional_params_json = model_params
            .additional_params
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());

        sqlx::query(
            "INSERT INTO assistants (id, name, role, description, system_prompt, user_prompt, model_id, 
             temperature, max_tokens, top_p, frequency_penalty, presence_penalty, additional_params,
             avatar_type, avatar_bg, avatar_text, avatar_image_path, avatar_image_url, 
             group_name, is_starred, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.role)
        .bind(&req.description)
        .bind(&req.system_prompt)
        .bind(&req.user_prompt)
        .bind(&req.model_id)
        .bind(model_params.temperature)
        .bind(model_params.max_tokens)
        .bind(model_params.top_p)
        .bind(model_params.frequency_penalty)
        .bind(model_params.presence_penalty)
        .bind(&additional_params_json)
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

        self.get_assistant(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created assistant"))
    }

    pub async fn get_assistant(&self, id: &str) -> Result<Option<Assistant>> {
        let row = sqlx::query(
            "SELECT id, name, role, description, system_prompt, user_prompt, model_id, 
             temperature, max_tokens, top_p, frequency_penalty, presence_penalty, additional_params,
             avatar_type, avatar_bg, avatar_text, avatar_image_path, avatar_image_url, 
             group_name, is_starred, created_at, updated_at
             FROM assistants WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => {
                let additional_params_str: Option<String> = row.get("additional_params");
                let additional_params = additional_params_str
                    .and_then(|s| serde_json::from_str(&s).ok());

                let is_starred: i32 = row.get("is_starred");

                Ok(Some(Assistant {
                    id: row.get("id"),
                    name: row.get("name"),
                    role: row.get("role"),
                    description: row.get("description"),
                    system_prompt: row.get("system_prompt"),
                    user_prompt: row.get("user_prompt"),
                    model_id: row.get("model_id"),
                    model_params: ModelParameters {
                        temperature: row.get("temperature"),
                        max_tokens: row.get("max_tokens"),
                        top_p: row.get("top_p"),
                        frequency_penalty: row.get("frequency_penalty"),
                        presence_penalty: row.get("presence_penalty"),
                        additional_params,
                    },
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
            "SELECT id, name, role, description, system_prompt, user_prompt, model_id, 
             temperature, max_tokens, top_p, frequency_penalty, presence_penalty, additional_params,
             avatar_type, avatar_bg, avatar_text, avatar_image_path, avatar_image_url, 
             group_name, is_starred, created_at, updated_at
             FROM assistants ORDER BY created_at DESC"
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let assistants = rows
            .iter()
            .map(|row| {
                let additional_params_str: Option<String> = row.get("additional_params");
                let additional_params = additional_params_str
                    .and_then(|s| serde_json::from_str(&s).ok());

                let is_starred: i32 = row.get("is_starred");

                Assistant {
                    id: row.get("id"),
                    name: row.get("name"),
                    role: row.get("role"),
                    description: row.get("description"),
                    system_prompt: row.get("system_prompt"),
                    user_prompt: row.get("user_prompt"),
                    model_id: row.get("model_id"),
                    model_params: ModelParameters {
                        temperature: row.get("temperature"),
                        max_tokens: row.get("max_tokens"),
                        top_p: row.get("top_p"),
                        frequency_penalty: row.get("frequency_penalty"),
                        presence_penalty: row.get("presence_penalty"),
                        additional_params,
                    },
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

    pub async fn update_assistant(&self, id: &str, req: CreateAssistantRequest) -> Result<Assistant> {
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);
        let avatar_type = req.avatar_type.unwrap_or_else(|| "text".to_string());

        // Extract model parameters
        let model_params = req.model_params.unwrap_or_default();
        let additional_params_json = model_params
            .additional_params
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());

        sqlx::query(
            "UPDATE assistants SET name = ?, role = ?, description = ?, system_prompt = ?, 
             user_prompt = ?, model_id = ?, temperature = ?, max_tokens = ?, top_p = ?,
             frequency_penalty = ?, presence_penalty = ?, additional_params = ?,
             avatar_type = ?, avatar_bg = ?, avatar_text = ?, 
             avatar_image_path = ?, avatar_image_url = ?, group_name = ?, 
             is_starred = ?, updated_at = ? WHERE id = ?"
        )
        .bind(&req.name)
        .bind(&req.role)
        .bind(&req.description)
        .bind(&req.system_prompt)
        .bind(&req.user_prompt)
        .bind(&req.model_id)
        .bind(model_params.temperature)
        .bind(model_params.max_tokens)
        .bind(model_params.top_p)
        .bind(model_params.frequency_penalty)
        .bind(model_params.presence_penalty)
        .bind(&additional_params_json)
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

        self.get_assistant(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Assistant not found"))
    }

    pub async fn delete_assistant(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM assistants WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }
}

