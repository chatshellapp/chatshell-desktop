use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateSkillRequest, Skill};

impl Database {
    pub async fn create_skill(&self, req: CreateSkillRequest) -> Result<Skill> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_enabled = req.is_enabled.unwrap_or(true);
        let allow_model = req.allow_model_invocation.unwrap_or(true);
        let allow_user = req.allow_user_invocation.unwrap_or(true);
        let required_tool_ids_json = req
            .required_tool_ids
            .as_ref()
            .map(|ids| serde_json::to_string(ids).unwrap_or_else(|_| "[]".to_string()));

        sqlx::query(
            "INSERT INTO skills (id, name, description, source, path, icon,
             required_tool_ids, allow_model_invocation, allow_user_invocation,
             content_hash, cached_instructions, is_enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.description)
        .bind(&req.source)
        .bind(&req.path)
        .bind(&req.icon)
        .bind(&required_tool_ids_json)
        .bind(allow_model as i32)
        .bind(allow_user as i32)
        .bind(&req.content_hash)
        .bind(&req.cached_instructions)
        .bind(is_enabled as i32)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_skill(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created skill"))
    }

    pub async fn get_skill(&self, id: &str) -> Result<Option<Skill>> {
        let row = sqlx::query("SELECT * FROM skills WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => Ok(Some(Self::skill_from_row(&row))),
            None => Ok(None),
        }
    }

    pub async fn get_skill_by_name(&self, name: &str) -> Result<Option<Skill>> {
        let row = sqlx::query("SELECT * FROM skills WHERE name = ?")
            .bind(name)
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => Ok(Some(Self::skill_from_row(&row))),
            None => Ok(None),
        }
    }

    pub async fn list_skills(&self) -> Result<Vec<Skill>> {
        let rows = sqlx::query("SELECT * FROM skills ORDER BY source ASC, name ASC")
            .fetch_all(self.pool.as_ref())
            .await?;

        Ok(rows.iter().map(Self::skill_from_row).collect())
    }

    pub async fn update_skill(&self, id: &str, req: CreateSkillRequest) -> Result<Skill> {
        let now = Utc::now().to_rfc3339();
        let is_enabled = req.is_enabled.unwrap_or(true);
        let allow_model = req.allow_model_invocation.unwrap_or(true);
        let allow_user = req.allow_user_invocation.unwrap_or(true);
        let required_tool_ids_json = req
            .required_tool_ids
            .as_ref()
            .map(|ids| serde_json::to_string(ids).unwrap_or_else(|_| "[]".to_string()));

        sqlx::query(
            "UPDATE skills SET name = ?, description = ?, source = ?, path = ?, icon = ?,
             required_tool_ids = ?, allow_model_invocation = ?, allow_user_invocation = ?,
             content_hash = ?, cached_instructions = ?, is_enabled = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&req.name)
        .bind(&req.description)
        .bind(&req.source)
        .bind(&req.path)
        .bind(&req.icon)
        .bind(&required_tool_ids_json)
        .bind(allow_model as i32)
        .bind(allow_user as i32)
        .bind(&req.content_hash)
        .bind(&req.cached_instructions)
        .bind(is_enabled as i32)
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        self.get_skill(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Skill not found"))
    }

    pub async fn delete_skill(&self, id: &str) -> Result<()> {
        // assistant_skills are cascade-deleted via FK constraint
        sqlx::query("DELETE FROM skills WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    pub async fn toggle_skill(&self, id: &str) -> Result<Skill> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE skills SET is_enabled = CASE WHEN is_enabled = 1 THEN 0 ELSE 1 END,
             updated_at = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        self.get_skill(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Skill not found"))
    }

    // ========================================================================
    // Assistant-Skill junction operations
    // ========================================================================

    /// Sync the assistant_skills junction table
    pub async fn sync_assistant_skills(
        &self,
        assistant_id: &str,
        skill_ids: &[String],
    ) -> Result<()> {
        sqlx::query("DELETE FROM assistant_skills WHERE assistant_id = ?")
            .bind(assistant_id)
            .execute(self.pool.as_ref())
            .await?;

        let now = Utc::now().to_rfc3339();
        for skill_id in skill_ids {
            let id = Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO assistant_skills (id, assistant_id, skill_id, created_at)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(assistant_id)
            .bind(skill_id)
            .bind(&now)
            .execute(self.pool.as_ref())
            .await?;
        }

        Ok(())
    }

    /// Get skill IDs associated with an assistant
    pub async fn get_assistant_skill_ids(&self, assistant_id: &str) -> Result<Vec<String>> {
        let skill_ids = sqlx::query_scalar::<_, String>(
            "SELECT skill_id FROM assistant_skills WHERE assistant_id = ? ORDER BY created_at ASC",
        )
        .bind(assistant_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(skill_ids)
    }

    /// Batch load all assistant -> skill_id mappings
    pub async fn get_all_assistant_skill_ids(
        &self,
    ) -> Result<std::collections::HashMap<String, Vec<String>>> {
        let rows = sqlx::query(
            "SELECT assistant_id, skill_id FROM assistant_skills ORDER BY created_at ASC",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row in rows {
            let assistant_id: String = row.get("assistant_id");
            let skill_id: String = row.get("skill_id");
            map.entry(assistant_id).or_default().push(skill_id);
        }

        Ok(map)
    }

    /// Get full Skill objects for an assistant
    pub async fn get_assistant_skills(&self, assistant_id: &str) -> Result<Vec<Skill>> {
        let rows = sqlx::query(
            "SELECT s.* FROM skills s
             JOIN assistant_skills as_ ON s.id = as_.skill_id
             WHERE as_.assistant_id = ?
             ORDER BY as_.created_at ASC",
        )
        .bind(assistant_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows.iter().map(Self::skill_from_row).collect())
    }

    // ========================================================================
    // Upsert by name (for skill scanner)
    // ========================================================================

    /// Upsert a skill by name. Used by the skill scanner to create or update skills.
    pub async fn upsert_skill_by_name(&self, req: CreateSkillRequest) -> Result<Skill> {
        if let Some(existing) = self.get_skill_by_name(&req.name).await? {
            // Only update if content_hash changed (or no hash yet)
            let should_update = match (&existing.content_hash, &req.content_hash) {
                (Some(old), Some(new)) => old != new,
                (None, Some(_)) => true,
                _ => false,
            };

            if should_update {
                self.update_skill(&existing.id, req).await
            } else {
                Ok(existing)
            }
        } else {
            self.create_skill(req).await
        }
    }

    // ========================================================================
    // Helper
    // ========================================================================

    fn skill_from_row(row: &sqlx::sqlite::SqliteRow) -> Skill {
        let required_tool_ids_str: Option<String> = row.get("required_tool_ids");
        let required_tool_ids: Vec<String> = required_tool_ids_str
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        Skill {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            source: row.get("source"),
            path: row.get("path"),
            icon: row.get("icon"),
            required_tool_ids,
            allow_model_invocation: row.get::<i32, _>("allow_model_invocation") != 0,
            allow_user_invocation: row.get::<i32, _>("allow_user_invocation") != 0,
            content_hash: row.get("content_hash"),
            cached_instructions: row.get("cached_instructions"),
            is_enabled: row.get::<i32, _>("is_enabled") != 0,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }
}
