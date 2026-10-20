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
        let row = sqlx::query("SELECT * FROM model_parameter_presets WHERE model_parameter_presets.deleted_at IS NULL AND id = ?")
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
        let rows = sqlx::query("SELECT * FROM model_parameter_presets WHERE model_parameter_presets.deleted_at IS NULL ORDER BY is_default DESC, is_system DESC, name ASC")
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
        let row = sqlx::query("SELECT * FROM model_parameter_presets WHERE model_parameter_presets.deleted_at IS NULL AND is_default = 1 LIMIT 1")
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
            "SELECT COUNT(*) FROM assistants WHERE assistants.deleted_at IS NULL AND model_parameter_preset_id = ?",
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

        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "model_parameter_presets",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }

    /// Create system default presets if they don't exist
    pub async fn ensure_default_presets(&self) -> Result<()> {
        // Check if any presets exist
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM model_parameter_presets WHERE model_parameter_presets.deleted_at IS NULL")
            .fetch_one(self.pool.as_ref())
            .await?;

        if count > 0 {
            return Ok(());
        }

        let now = Utc::now().to_rfc3339();

        // Deterministic ids (UUID v5 over a fixed namespace): every device
        // seeds the SAME rows, so a fresh database merging a remote snapshot
        // meets identical preset ids instead of colliding on the UNIQUE
        // name while remote assistants still reference the old random ids
        // (real-device S6 finding: the FK failure aborted the whole merge).
        let balanced_id = super::system_ids::system_uuid("chatshell.preset.balanced");
        let creative_id = super::system_ids::system_uuid("chatshell.preset.creative");
        let precise_id = super::system_ids::system_uuid("chatshell.preset.precise");

        // Create Balanced preset (default)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    fn create_req(name: &str) -> CreateModelParameterPresetRequest {
        CreateModelParameterPresetRequest {
            name: name.to_string(),
            description: Some("test preset".to_string()),
            temperature: Some(0.5),
            max_tokens: Some(2048),
            top_p: Some(0.9),
            frequency_penalty: Some(0.1),
            presence_penalty: Some(0.2),
            additional_params: Some(json!({"seed": 42, "stop": ["\n\n"]})),
            is_default: Some(false),
        }
    }

    fn update_req() -> UpdateModelParameterPresetRequest {
        UpdateModelParameterPresetRequest {
            name: None,
            description: None,
            temperature: None,
            max_tokens: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            additional_params: None,
            is_default: None,
        }
    }

    #[tokio::test]
    async fn create_and_get_round_trips_all_fields() {
        let (db, _dir) = test_db().await;
        let preset = db
            .create_model_parameter_preset(create_req("My Preset"))
            .await
            .unwrap();

        assert_eq!(preset.name, "My Preset");
        assert_eq!(preset.description.as_deref(), Some("test preset"));
        assert_eq!(preset.temperature, Some(0.5));
        assert_eq!(preset.max_tokens, Some(2048));
        assert_eq!(preset.top_p, Some(0.9));
        assert_eq!(preset.frequency_penalty, Some(0.1));
        assert_eq!(preset.presence_penalty, Some(0.2));
        assert_eq!(
            preset.additional_params,
            Some(json!({"seed": 42, "stop": ["\n\n"]}))
        );
        assert!(!preset.is_system);
        assert!(!preset.is_default);

        let fetched = db
            .get_model_parameter_preset(&preset.id)
            .await
            .unwrap()
            .expect("created preset must be readable");
        assert_eq!(fetched.id, preset.id);
        assert_eq!(fetched.name, "My Preset");
        assert_eq!(fetched.temperature, Some(0.5));
        assert_eq!(fetched.max_tokens, Some(2048));
        assert_eq!(
            fetched.additional_params,
            Some(json!({"seed": 42, "stop": ["\n\n"]}))
        );
        assert!(!fetched.is_system);
    }

    #[tokio::test]
    async fn create_minimal_preset_leaves_optionals_null() {
        let (db, _dir) = test_db().await;
        let preset = db
            .create_model_parameter_preset(CreateModelParameterPresetRequest {
                name: "Bare".to_string(),
                description: None,
                temperature: None,
                max_tokens: None,
                top_p: None,
                frequency_penalty: None,
                presence_penalty: None,
                additional_params: None,
                is_default: None,
            })
            .await
            .unwrap();

        assert!(preset.description.is_none());
        assert!(preset.temperature.is_none());
        assert!(preset.max_tokens.is_none());
        assert!(preset.top_p.is_none());
        assert!(preset.frequency_penalty.is_none());
        assert!(preset.presence_penalty.is_none());
        assert!(preset.additional_params.is_none());
        // is_default falls back to false when unset
        assert!(!preset.is_default);
    }

    #[tokio::test]
    async fn get_missing_preset_returns_none() {
        let (db, _dir) = test_db().await;
        let id = Uuid::now_v7().to_string();
        assert!(db.get_model_parameter_preset(&id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_orders_default_first_then_system_then_user_by_name() {
        let (db, _dir) = test_db().await;
        db.create_model_parameter_preset(create_req("Zeta"))
            .await
            .unwrap();
        db.create_model_parameter_preset(create_req("Alpha"))
            .await
            .unwrap();

        let names: Vec<String> = db
            .list_model_parameter_presets()
            .await
            .unwrap()
            .into_iter()
            .map(|p| p.name)
            .collect();
        // default first, then system presets, then user presets by name
        assert_eq!(
            names,
            vec!["Balanced", "Creative", "Precise", "Alpha", "Zeta"]
        );
    }

    #[tokio::test]
    async fn seeded_default_preset_is_balanced() {
        let (db, _dir) = test_db().await;
        let default = db
            .get_default_model_parameter_preset()
            .await
            .unwrap()
            .expect("Database::new must seed a default preset");
        assert_eq!(default.name, "Balanced");
        assert!(default.is_system);
        assert!(default.is_default);
        assert_eq!(default.temperature, Some(0.7));
        assert_eq!(default.max_tokens, Some(4096));
        assert_eq!(default.top_p, Some(0.8));
        assert_eq!(default.frequency_penalty, Some(0.0));
        assert_eq!(default.presence_penalty, Some(0.0));
    }

    #[tokio::test]
    async fn creating_default_preset_unsets_previous_default() {
        let (db, _dir) = test_db().await;
        let seeded_default = db
            .get_default_model_parameter_preset()
            .await
            .unwrap()
            .unwrap();

        let mut req = create_req("New Default");
        req.is_default = Some(true);
        let created = db.create_model_parameter_preset(req).await.unwrap();
        assert!(created.is_default);

        let default = db
            .get_default_model_parameter_preset()
            .await
            .unwrap()
            .unwrap();
        assert_eq!(default.id, created.id);

        let old = db
            .get_model_parameter_preset(&seeded_default.id)
            .await
            .unwrap()
            .unwrap();
        assert!(!old.is_default);
    }

    #[tokio::test]
    async fn update_partial_changes_only_provided_fields() {
        let (db, _dir) = test_db().await;
        let preset = db
            .create_model_parameter_preset(create_req("Original"))
            .await
            .unwrap();

        let mut req = update_req();
        req.name = Some("Renamed".to_string());
        req.temperature = Some(1.5);
        let updated = db
            .update_model_parameter_preset(&preset.id, req)
            .await
            .unwrap();

        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.temperature, Some(1.5));
        // Untouched fields keep their stored values
        assert_eq!(updated.description.as_deref(), Some("test preset"));
        assert_eq!(updated.max_tokens, Some(2048));
        assert_eq!(updated.top_p, Some(0.9));
        assert_eq!(updated.frequency_penalty, Some(0.1));
        assert_eq!(updated.presence_penalty, Some(0.2));
        assert_eq!(
            updated.additional_params,
            Some(json!({"seed": 42, "stop": ["\n\n"]}))
        );
        assert!(!updated.is_default);
    }

    #[tokio::test]
    async fn update_empty_request_returns_preset_unchanged() {
        let (db, _dir) = test_db().await;
        let preset = db
            .create_model_parameter_preset(create_req("Stable"))
            .await
            .unwrap();

        let updated = db
            .update_model_parameter_preset(&preset.id, update_req())
            .await
            .unwrap();
        assert_eq!(updated.id, preset.id);
        assert_eq!(updated.name, "Stable");
        assert_eq!(updated.temperature, Some(0.5));
        assert_eq!(updated.max_tokens, Some(2048));
    }

    #[tokio::test]
    async fn update_can_move_and_clear_default_flag() {
        let (db, _dir) = test_db().await;
        let mut req = create_req("Flagged");
        req.is_default = Some(true);
        let preset = db.create_model_parameter_preset(req).await.unwrap();
        assert_eq!(
            db.get_default_model_parameter_preset()
                .await
                .unwrap()
                .unwrap()
                .id,
            preset.id
        );

        // Unsetting the only default leaves the database without any default
        let mut req = update_req();
        req.is_default = Some(false);
        let updated = db
            .update_model_parameter_preset(&preset.id, req)
            .await
            .unwrap();
        assert!(!updated.is_default);
        assert!(
            db.get_default_model_parameter_preset()
                .await
                .unwrap()
                .is_none()
        );

        // Moving the flag via update: the newly flagged preset becomes the
        // default and no other preset keeps it.
        let other = db
            .create_model_parameter_preset(create_req("Other"))
            .await
            .unwrap();
        let mut req = update_req();
        req.is_default = Some(true);
        db.update_model_parameter_preset(&other.id, req)
            .await
            .unwrap();
        assert_eq!(
            db.get_default_model_parameter_preset()
                .await
                .unwrap()
                .unwrap()
                .id,
            other.id
        );
    }

    #[tokio::test]
    async fn update_system_preset_is_rejected() {
        let (db, _dir) = test_db().await;
        let seeded = db
            .get_default_model_parameter_preset()
            .await
            .unwrap()
            .unwrap();

        let mut req = update_req();
        req.name = Some("Hacked".to_string());
        let err = db
            .update_model_parameter_preset(&seeded.id, req)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Cannot modify system presets"));

        // The system preset is untouched
        assert_eq!(
            db.get_model_parameter_preset(&seeded.id)
                .await
                .unwrap()
                .unwrap()
                .name,
            "Balanced"
        );
    }

    #[tokio::test]
    async fn update_missing_preset_is_rejected() {
        let (db, _dir) = test_db().await;
        let err = db
            .update_model_parameter_preset(&Uuid::now_v7().to_string(), update_req())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Preset not found"));
    }

    #[tokio::test]
    async fn delete_soft_deletes_preset() {
        let (db, _dir) = test_db().await;
        let preset = db
            .create_model_parameter_preset(create_req("Doomed"))
            .await
            .unwrap();
        db.delete_model_parameter_preset(&preset.id).await.unwrap();

        assert!(
            db.get_model_parameter_preset(&preset.id)
                .await
                .unwrap()
                .is_none()
        );
        let names: Vec<String> = db
            .list_model_parameter_presets()
            .await
            .unwrap()
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert!(!names.contains(&"Doomed".to_string()));
    }

    #[tokio::test]
    async fn delete_missing_preset_is_rejected() {
        let (db, _dir) = test_db().await;
        let err = db
            .delete_model_parameter_preset(&Uuid::now_v7().to_string())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Preset not found"));
    }

    #[tokio::test]
    async fn delete_twice_is_rejected() {
        let (db, _dir) = test_db().await;
        let preset = db
            .create_model_parameter_preset(create_req("Once"))
            .await
            .unwrap();
        db.delete_model_parameter_preset(&preset.id).await.unwrap();
        let err = db
            .delete_model_parameter_preset(&preset.id)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Preset not found"));
    }

    #[tokio::test]
    async fn delete_system_preset_is_rejected() {
        let (db, _dir) = test_db().await;
        let seeded = db
            .get_default_model_parameter_preset()
            .await
            .unwrap()
            .unwrap();
        let err = db
            .delete_model_parameter_preset(&seeded.id)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Cannot delete system presets"));
        assert!(
            db.get_model_parameter_preset(&seeded.id)
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn delete_preset_in_use_by_assistant_is_rejected() {
        let (db, _dir) = test_db().await;
        let preset = db
            .create_model_parameter_preset(create_req("In Use"))
            .await
            .unwrap();
        insert_assistant_referencing(&db, &preset.id).await;

        let err = db
            .delete_model_parameter_preset(&preset.id)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("assistant"));
        assert!(
            db.get_model_parameter_preset(&preset.id)
                .await
                .unwrap()
                .is_some()
        );
    }

    /// Minimal provider -> model -> assistant chain so an assistant row
    /// references the given preset (foreign keys are enforced).
    async fn insert_assistant_referencing(db: &Database, preset_id: &str) {
        let now = "2026-01-01T00:00:00Z";
        sqlx::query(
            "INSERT INTO providers (id, name, provider_type, created_at, updated_at) \
             VALUES ('guard-provider', 'Guard Provider', 'openai', ?, ?)",
        )
        .bind(now)
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO models (id, name, provider_id, model_id, created_at, updated_at) \
             VALUES ('guard-model', 'Guard Model', 'guard-provider', 'guard-model', ?, ?)",
        )
        .bind(now)
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO assistants (id, name, system_prompt, model_id, \
             model_parameter_preset_id, created_at, updated_at) \
             VALUES ('guard-assistant', 'Guard Assistant', 'sys', 'guard-model', ?, ?, ?)",
        )
        .bind(preset_id)
        .bind(now)
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn ensure_default_presets_is_idempotent() {
        let (db, _dir) = test_db().await;
        // Database::new already seeded the three system presets
        db.ensure_default_presets().await.unwrap();
        db.ensure_default_presets().await.unwrap();

        let presets = db.list_model_parameter_presets().await.unwrap();
        assert_eq!(presets.len(), 3);
        let names: Vec<String> = presets.into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["Balanced", "Creative", "Precise"]);

        // Any existing preset (even user-created) suppresses re-seeding
        db.create_model_parameter_preset(create_req("User Preset"))
            .await
            .unwrap();
        db.ensure_default_presets().await.unwrap();
        assert_eq!(db.list_model_parameter_presets().await.unwrap().len(), 4);
    }
}
