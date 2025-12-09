use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{
    CreateModelParameterPresetRequest, ModelParameterPreset, UpdateModelParameterPresetRequest,
};

impl Database {
    pub async fn create_model_parameter_preset(
        &self,
        req: CreateModelParameterPresetRequest,
    ) -> Result<ModelParameterPreset> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_default = req.is_default.unwrap_or(false);
        let additional_params_json = req
            .additional_params
            .as_ref()
            .and_then(|v| serde_json::to_string(v).ok());

        // If this preset is being set as default, unset all other defaults
        if is_default {
            sqlx::query("UPDATE model_parameter_presets SET is_default = 0")
                .execute(self.pool.as_ref())
                .await?;
        }

        sqlx::query(
            "INSERT INTO model_parameter_presets 
             (id, name, description, temperature, max_tokens, top_p, frequency_penalty, 
              presence_penalty, additional_params, is_system, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.description)
        .bind(req.temperature)
        .bind(req.max_tokens)
        .bind(req.top_p)
        .bind(req.frequency_penalty)
        .bind(req.presence_penalty)
        .bind(&additional_params_json)
        .bind(is_default as i32)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_model_parameter_preset(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created preset"))
    }

    pub async fn get_model_parameter_preset(
        &self,
        id: &str,
    ) -> Result<Option<ModelParameterPreset>> {
        let row = sqlx::query("SELECT * FROM model_parameter_presets WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => {
                let additional_params: Option<serde_json::Value> = row
                    .get::<Option<String>, _>("additional_params")
                    .and_then(|s| serde_json::from_str(&s).ok());

                Ok(Some(ModelParameterPreset {
                    id: row.get("id"),
                    name: row.get("name"),
                    description: row.get("description"),
                    temperature: row.get("temperature"),
                    max_tokens: row.get("max_tokens"),
                    top_p: row.get("top_p"),
                    frequency_penalty: row.get("frequency_penalty"),
                    presence_penalty: row.get("presence_penalty"),
                    additional_params,
                    is_system: row.get::<i32, _>("is_system") != 0,
                    is_default: row.get::<i32, _>("is_default") != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn list_model_parameter_presets(&self) -> Result<Vec<ModelParameterPreset>> {
        let rows = sqlx::query("SELECT * FROM model_parameter_presets ORDER BY is_default DESC, is_system DESC, name ASC")
            .fetch_all(self.pool.as_ref())
            .await?;

        let mut presets = Vec::new();
        for row in rows {
            let additional_params: Option<serde_json::Value> = row
                .get::<Option<String>, _>("additional_params")
                .and_then(|s| serde_json::from_str(&s).ok());

            presets.push(ModelParameterPreset {
                id: row.get("id"),
                name: row.get("name"),
                description: row.get("description"),
                temperature: row.get("temperature"),
                max_tokens: row.get("max_tokens"),
                top_p: row.get("top_p"),
                frequency_penalty: row.get("frequency_penalty"),
                presence_penalty: row.get("presence_penalty"),
                additional_params,
                is_system: row.get::<i32, _>("is_system") != 0,
                is_default: row.get::<i32, _>("is_default") != 0,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            });
        }

        Ok(presets)
    }

    pub async fn get_default_model_parameter_preset(&self) -> Result<Option<ModelParameterPreset>> {
        let row = sqlx::query("SELECT * FROM model_parameter_presets WHERE is_default = 1 LIMIT 1")
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => {
                let additional_params: Option<serde_json::Value> = row
                    .get::<Option<String>, _>("additional_params")
                    .and_then(|s| serde_json::from_str(&s).ok());

                Ok(Some(ModelParameterPreset {
                    id: row.get("id"),
                    name: row.get("name"),
                    description: row.get("description"),
                    temperature: row.get("temperature"),
                    max_tokens: row.get("max_tokens"),
                    top_p: row.get("top_p"),
                    frequency_penalty: row.get("frequency_penalty"),
                    presence_penalty: row.get("presence_penalty"),
                    additional_params,
                    is_system: row.get::<i32, _>("is_system") != 0,
                    is_default: row.get::<i32, _>("is_default") != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn update_model_parameter_preset(
        &self,
        id: &str,
        req: UpdateModelParameterPresetRequest,
    ) -> Result<ModelParameterPreset> {
        let now = Utc::now().to_rfc3339();

        // Check if preset is system preset (cannot be modified)
        let preset = self
            .get_model_parameter_preset(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Preset not found"))?;

        if preset.is_system {
            return Err(anyhow::anyhow!("Cannot modify system presets"));
        }

        // If setting as default, unset all other defaults
        if let Some(true) = req.is_default {
            sqlx::query("UPDATE model_parameter_presets SET is_default = 0")
                .execute(self.pool.as_ref())
                .await?;
        }

        // Build dynamic update query based on provided fields
        let mut updates = Vec::new();
        let mut query = "UPDATE model_parameter_presets SET ".to_string();

        if req.name.is_some() {
            updates.push("name = ?");
        }
        if req.description.is_some() {
            updates.push("description = ?");
        }
        if req.temperature.is_some() {
            updates.push("temperature = ?");
        }
        if req.max_tokens.is_some() {
            updates.push("max_tokens = ?");
        }
        if req.top_p.is_some() {
            updates.push("top_p = ?");
        }
        if req.frequency_penalty.is_some() {
            updates.push("frequency_penalty = ?");
        }
        if req.presence_penalty.is_some() {
            updates.push("presence_penalty = ?");
        }
        if req.additional_params.is_some() {
            updates.push("additional_params = ?");
        }
        if req.is_default.is_some() {
            updates.push("is_default = ?");
        }

        if updates.is_empty() {
            return self
                .get_model_parameter_preset(id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("Preset not found"));
        }

        updates.push("updated_at = ?");
        query.push_str(&updates.join(", "));
        query.push_str(" WHERE id = ?");

        let mut q = sqlx::query(&query);

        if let Some(name) = &req.name {
            q = q.bind(name);
        }
        if let Some(description) = &req.description {
            q = q.bind(description);
        }
        if let Some(temperature) = req.temperature {
            q = q.bind(temperature);
        }
        if let Some(max_tokens) = req.max_tokens {
            q = q.bind(max_tokens);
        }
        if let Some(top_p) = req.top_p {
            q = q.bind(top_p);
        }
        if let Some(frequency_penalty) = req.frequency_penalty {
            q = q.bind(frequency_penalty);
        }
        if let Some(presence_penalty) = req.presence_penalty {
            q = q.bind(presence_penalty);
        }
        if let Some(additional_params) = &req.additional_params {
            let json_str = serde_json::to_string(additional_params)?;
            q = q.bind(json_str);
        }
        if let Some(is_default) = req.is_default {
            q = q.bind(is_default as i32);
        }

        q = q.bind(&now).bind(id);
        q.execute(self.pool.as_ref()).await?;

        self.get_model_parameter_preset(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve updated preset"))
    }

    pub async fn delete_model_parameter_preset(&self, id: &str) -> Result<()> {
        // Check if preset is system preset (cannot be deleted)
        let preset = self
            .get_model_parameter_preset(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Preset not found"))?;

        if preset.is_system {
            return Err(anyhow::anyhow!("Cannot delete system presets"));
        }

        // Check if any assistants are using this preset
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM assistants WHERE model_parameter_preset_id = ?",
        )
        .bind(id)
        .fetch_one(self.pool.as_ref())
        .await?;

        if count > 0 {
            return Err(anyhow::anyhow!(
                "Cannot delete preset: {} assistant(s) are using it",
                count
            ));
        }

        sqlx::query("DELETE FROM model_parameter_presets WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        Ok(())
    }

    /// Create system default presets if they don't exist
    pub async fn ensure_default_presets(&self) -> Result<()> {
        // Check if any presets exist
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM model_parameter_presets")
            .fetch_one(self.pool.as_ref())
            .await?;

        if count > 0 {
            return Ok(());
        }

        let now = Utc::now().to_rfc3339();

        // Create Balanced preset (default)
        let balanced_id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO model_parameter_presets 
             (id, name, description, temperature, max_tokens, top_p, frequency_penalty, 
              presence_penalty, additional_params, is_system, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, ?, ?)",
        )
        .bind(&balanced_id)
        .bind("Balanced")
        .bind("Balanced parameters suitable for most tasks")
        .bind(0.7)
        .bind(4096)
        .bind(0.8)
        .bind(0.0)
        .bind(0.0)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        // Create Creative preset
        let creative_id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO model_parameter_presets 
             (id, name, description, temperature, max_tokens, top_p, frequency_penalty, 
              presence_penalty, additional_params, is_system, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, ?, ?)",
        )
        .bind(&creative_id)
        .bind("Creative")
        .bind("High creativity for brainstorming and creative writing")
        .bind(1.2)
        .bind(4096)
        .bind(0.95)
        .bind(0.5)
        .bind(0.5)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        // Create Precise preset
        let precise_id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO model_parameter_presets 
             (id, name, description, temperature, max_tokens, top_p, frequency_penalty, 
              presence_penalty, additional_params, is_system, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, ?, ?)",
        )
        .bind(&precise_id)
        .bind("Precise")
        .bind("Low temperature for accurate, deterministic responses")
        .bind(0.3)
        .bind(4096)
        .bind(0.5)
        .bind(0.0)
        .bind(0.0)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }
}
