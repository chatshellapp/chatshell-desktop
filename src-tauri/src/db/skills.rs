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
        let row = sqlx::query("SELECT * FROM skills WHERE skills.deleted_at IS NULL AND id = ?")
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => Ok(Some(Self::skill_from_row(&row))),
            None => Ok(None),
        }
    }

    pub async fn get_skill_by_name(&self, name: &str) -> Result<Option<Skill>> {
        let row = sqlx::query("SELECT * FROM skills WHERE skills.deleted_at IS NULL AND name = ?")
            .bind(name)
            .fetch_optional(self.pool.as_ref())
            .await?;

        match row {
            Some(row) => Ok(Some(Self::skill_from_row(&row))),
            None => Ok(None),
        }
    }

    pub async fn get_skill_by_name_and_source(
        &self,
        name: &str,
        source: &str,
    ) -> Result<Option<Skill>> {
        let row = sqlx::query(
            "SELECT * FROM skills WHERE skills.deleted_at IS NULL AND name = ? AND source = ?",
        )
        .bind(name)
        .bind(source)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(Some(Self::skill_from_row(&row))),
            None => Ok(None),
        }
    }

    pub async fn list_skills(&self) -> Result<Vec<Skill>> {
        let rows = sqlx::query(
            "SELECT * FROM skills WHERE skills.deleted_at IS NULL ORDER BY source ASC, name ASC",
        )
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
        // Tombstone the skill and its assistant_skills junctions explicitly:
        // the FK cascade never fires on a tombstone UPDATE, so without this
        // the junction rows would ride every snapshot forever.
        let now = chrono::Utc::now().to_rfc3339();
        for (table, where_clause) in [
            ("assistant_skills", "skill_id = ?2 AND deleted_at IS NULL"),
            ("skills", "id = ?2 AND deleted_at IS NULL"),
        ] {
            sqlx::query(&crate::db::soft_delete::tombstone_update(
                table,
                where_clause,
            ))
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        }
        Ok(())
    }

    pub async fn set_all_skills_enabled(&self, enabled: bool) -> Result<Vec<Skill>> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE skills SET is_enabled = ?, updated_at = ?")
            .bind(enabled as i32)
            .bind(&now)
            .execute(self.pool.as_ref())
            .await?;

        self.list_skills().await
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
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "assistant_skills",
            "assistant_id = ?2 AND deleted_at IS NULL",
        ))
        .bind(Utc::now().to_rfc3339())
        .bind(assistant_id)
        .execute(self.pool.as_ref())
        .await?;

        let now = Utc::now().to_rfc3339();
        for skill_id in skill_ids {
            let id = Uuid::now_v7().to_string();
            // Revive a tombstoned row instead of re-inserting: the UNIQUE
            // (assistant_id, skill_id) key is still held by the tombstone,
            // so a plain INSERT would fail for any retained skill.
            sqlx::query(
                "INSERT INTO assistant_skills (id, assistant_id, skill_id, created_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(assistant_id, skill_id)
                 DO UPDATE SET deleted_at = NULL, created_at = excluded.created_at",
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
            "SELECT skill_id FROM assistant_skills WHERE assistant_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
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
            "SELECT assistant_id, skill_id FROM assistant_skills WHERE deleted_at IS NULL ORDER BY created_at ASC",
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
             WHERE s.deleted_at IS NULL AND as_.assistant_id = ? AND as_.deleted_at IS NULL
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

    /// Upsert a skill by (name, source) composite key.
    /// Different sources can have skills with the same name.
    pub async fn upsert_skill_by_name_and_source(&self, req: CreateSkillRequest) -> Result<Skill> {
        if let Some(existing) = self
            .get_skill_by_name_and_source(&req.name, &req.source)
            .await?
        {
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
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateAssistantRequest, CreateModelRequest, CreateProviderRequest};

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    fn skill_req(name: &str, source: &str) -> CreateSkillRequest {
        CreateSkillRequest {
            name: name.to_string(),
            description: Some(format!("Description for {name}")),
            source: source.to_string(),
            path: format!("/skills/{source}/{name}"),
            icon: Some("star".to_string()),
            required_tool_ids: Some(vec!["builtin-web-search".to_string()]),
            allow_model_invocation: Some(true),
            allow_user_invocation: Some(false),
            content_hash: Some("hash-v1".to_string()),
            cached_instructions: Some("Instructions v1".to_string()),
            is_enabled: Some(true),
        }
    }

    /// Create the provider -> model -> assistant chain the assistants FK
    /// requires, and return the assistant id.
    async fn make_assistant(db: &Database) -> String {
        let provider = db
            .create_provider(CreateProviderRequest {
                name: "Unit Test Provider".to_string(),
                provider_type: "unit-test".to_string(),
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
                name: "Unit Test Model".to_string(),
                provider_id: provider.id,
                model_id: "unit-test-model".to_string(),
                description: None,
                is_starred: None,
            })
            .await
            .unwrap();
        let assistant = db
            .create_assistant(CreateAssistantRequest {
                name: "Unit Test Assistant".to_string(),
                role: None,
                description: None,
                system_prompt: "system prompt".to_string(),
                user_prompt: None,
                model_id: model.id,
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
            })
            .await
            .unwrap();
        assistant.id
    }

    #[tokio::test]
    async fn create_skill_round_trips_all_fields() {
        let (db, _dir) = test_db().await;
        let skill = db.create_skill(skill_req("alpha", "user")).await.unwrap();

        assert_eq!(skill.name, "alpha");
        assert_eq!(skill.description.as_deref(), Some("Description for alpha"));
        assert_eq!(skill.source, "user");
        assert_eq!(skill.path, "/skills/user/alpha");
        assert_eq!(skill.icon.as_deref(), Some("star"));
        assert_eq!(
            skill.required_tool_ids,
            vec!["builtin-web-search".to_string()]
        );
        assert!(skill.allow_model_invocation);
        assert!(!skill.allow_user_invocation);
        assert_eq!(skill.content_hash.as_deref(), Some("hash-v1"));
        assert_eq!(
            skill.cached_instructions.as_deref(),
            Some("Instructions v1")
        );
        assert!(skill.is_enabled);
        assert!(!skill.created_at.is_empty());
        assert!(!skill.updated_at.is_empty());

        let fetched = db.get_skill(&skill.id).await.unwrap().unwrap();
        assert_eq!(fetched.id, skill.id);
        assert_eq!(fetched.name, "alpha");
        assert_eq!(
            fetched.required_tool_ids,
            vec!["builtin-web-search".to_string()]
        );
        assert_eq!(fetched.content_hash.as_deref(), Some("hash-v1"));
    }

    #[tokio::test]
    async fn create_skill_applies_defaults_for_optional_flags() {
        let (db, _dir) = test_db().await;
        let skill = db
            .create_skill(CreateSkillRequest {
                name: "defaults".to_string(),
                description: None,
                source: "user".to_string(),
                path: "/skills/user/defaults".to_string(),
                icon: None,
                required_tool_ids: None,
                allow_model_invocation: None,
                allow_user_invocation: None,
                content_hash: None,
                cached_instructions: None,
                is_enabled: None,
            })
            .await
            .unwrap();

        assert!(skill.allow_model_invocation);
        assert!(skill.allow_user_invocation);
        assert!(skill.is_enabled);
        assert!(skill.required_tool_ids.is_empty());
        assert_eq!(skill.description, None);
        assert_eq!(skill.icon, None);
        assert_eq!(skill.content_hash, None);
    }

    #[tokio::test]
    async fn create_skill_rejects_duplicate_name_and_source() {
        let (db, _dir) = test_db().await;
        db.create_skill(skill_req("dup", "user")).await.unwrap();
        let result = db.create_skill(skill_req("dup", "user")).await;
        assert!(
            result.is_err(),
            "UNIQUE(name, source) must reject duplicates"
        );
    }

    #[tokio::test]
    async fn get_skill_returns_none_for_unknown_id() {
        let (db, _dir) = test_db().await;
        assert!(db.get_skill("no-such-skill").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn get_skill_by_name_finds_and_misses() {
        let (db, _dir) = test_db().await;
        let skill = db.create_skill(skill_req("findme", "user")).await.unwrap();

        let found = db.get_skill_by_name("findme").await.unwrap().unwrap();
        assert_eq!(found.id, skill.id);
        assert!(
            db.get_skill_by_name("unknown-skill")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn get_skill_by_name_and_source_distinguishes_sources() {
        let (db, _dir) = test_db().await;
        let builtin = db
            .create_skill(skill_req("shared", "builtin"))
            .await
            .unwrap();
        let user = db.create_skill(skill_req("shared", "user")).await.unwrap();

        let got_builtin = db
            .get_skill_by_name_and_source("shared", "builtin")
            .await
            .unwrap()
            .unwrap();
        let got_user = db
            .get_skill_by_name_and_source("shared", "user")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got_builtin.id, builtin.id);
        assert_eq!(got_user.id, user.id);
        assert_ne!(got_builtin.id, got_user.id);
        assert!(
            db.get_skill_by_name_and_source("shared", "claude")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn list_skills_sorts_by_source_then_name() {
        let (db, _dir) = test_db().await;
        db.create_skill(skill_req("beta", "user")).await.unwrap();
        db.create_skill(skill_req("alpha", "user")).await.unwrap();
        db.create_skill(skill_req("zeta", "builtin")).await.unwrap();

        let skills = db.list_skills().await.unwrap();
        let keys: Vec<(String, String)> = skills
            .iter()
            .filter(|s| ["alpha", "beta", "zeta"].contains(&s.name.as_str()))
            .map(|s| (s.source.clone(), s.name.clone()))
            .collect();
        assert_eq!(
            keys,
            vec![
                ("builtin".to_string(), "zeta".to_string()),
                ("user".to_string(), "alpha".to_string()),
                ("user".to_string(), "beta".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn update_skill_persists_all_fields() {
        let (db, _dir) = test_db().await;
        let skill = db
            .create_skill(skill_req("original", "user"))
            .await
            .unwrap();

        let updated = db
            .update_skill(
                &skill.id,
                CreateSkillRequest {
                    name: "renamed".to_string(),
                    description: Some("New description".to_string()),
                    source: "user".to_string(),
                    path: "/skills/user/renamed".to_string(),
                    icon: Some("spark".to_string()),
                    required_tool_ids: Some(vec![
                        "builtin-web-search".to_string(),
                        "builtin-bash".to_string(),
                    ]),
                    allow_model_invocation: Some(false),
                    allow_user_invocation: Some(true),
                    content_hash: Some("hash-v2".to_string()),
                    cached_instructions: Some("Instructions v2".to_string()),
                    is_enabled: Some(false),
                },
            )
            .await
            .unwrap();

        assert_eq!(updated.id, skill.id);
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.description.as_deref(), Some("New description"));
        assert_eq!(updated.path, "/skills/user/renamed");
        assert_eq!(updated.icon.as_deref(), Some("spark"));
        assert_eq!(
            updated.required_tool_ids,
            vec!["builtin-web-search".to_string(), "builtin-bash".to_string(),]
        );
        assert!(!updated.allow_model_invocation);
        assert!(updated.allow_user_invocation);
        assert_eq!(updated.content_hash.as_deref(), Some("hash-v2"));
        assert_eq!(
            updated.cached_instructions.as_deref(),
            Some("Instructions v2")
        );
        assert!(!updated.is_enabled);

        let refetched = db.get_skill(&skill.id).await.unwrap().unwrap();
        assert_eq!(refetched.name, "renamed");
        assert!(!refetched.is_enabled);
        assert_eq!(refetched.content_hash.as_deref(), Some("hash-v2"));
    }

    #[tokio::test]
    async fn update_skill_unknown_id_errors() {
        let (db, _dir) = test_db().await;
        let result = db
            .update_skill("no-such-skill", skill_req("ghost", "user"))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn delete_skill_hides_skill_and_unlinks_assistants() {
        let (db, _dir) = test_db().await;
        let assistant_id = make_assistant(&db).await;
        let skill = db.create_skill(skill_req("doomed", "user")).await.unwrap();
        db.sync_assistant_skills(&assistant_id, std::slice::from_ref(&skill.id))
            .await
            .unwrap();
        assert_eq!(
            db.get_assistant_skills(&assistant_id).await.unwrap().len(),
            1
        );

        db.delete_skill(&skill.id).await.unwrap();

        assert!(db.get_skill(&skill.id).await.unwrap().is_none());
        assert!(db.get_skill_by_name("doomed").await.unwrap().is_none());
        assert!(
            db.get_skill_by_name_and_source("doomed", "user")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            !db.list_skills()
                .await
                .unwrap()
                .iter()
                .any(|s| s.id == skill.id)
        );
        // The junction row is tombstoned alongside the skill, so the
        // assistant no longer resolves the skill.
        assert!(
            db.get_assistant_skills(&assistant_id)
                .await
                .unwrap()
                .is_empty()
        );
        let tombstoned_junctions: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM assistant_skills WHERE skill_id = ? AND deleted_at IS NOT NULL",
        )
        .bind(&skill.id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(tombstoned_junctions, 1);
    }

    #[tokio::test]
    async fn set_all_skills_enabled_toggles_every_skill() {
        let (db, _dir) = test_db().await;
        let s1 = db.create_skill(skill_req("one", "user")).await.unwrap();
        let mut disabled_req = skill_req("two", "user");
        disabled_req.is_enabled = Some(false);
        let s2 = db.create_skill(disabled_req).await.unwrap();

        let all = db.set_all_skills_enabled(false).await.unwrap();
        assert!(
            all.iter().all(|s| !s.is_enabled),
            "every skill must be disabled"
        );
        assert!(!db.get_skill(&s1.id).await.unwrap().unwrap().is_enabled);
        assert!(!db.get_skill(&s2.id).await.unwrap().unwrap().is_enabled);

        let all = db.set_all_skills_enabled(true).await.unwrap();
        assert!(
            all.iter().all(|s| s.is_enabled),
            "every skill must be enabled"
        );
        assert!(db.get_skill(&s1.id).await.unwrap().unwrap().is_enabled);
        assert!(db.get_skill(&s2.id).await.unwrap().unwrap().is_enabled);
    }

    #[tokio::test]
    async fn toggle_skill_flips_enabled_state() {
        let (db, _dir) = test_db().await;
        let skill = db.create_skill(skill_req("flip", "user")).await.unwrap();
        assert!(skill.is_enabled);

        let toggled = db.toggle_skill(&skill.id).await.unwrap();
        assert!(!toggled.is_enabled);
        assert!(!db.get_skill(&skill.id).await.unwrap().unwrap().is_enabled);

        let toggled = db.toggle_skill(&skill.id).await.unwrap();
        assert!(toggled.is_enabled);
    }

    #[tokio::test]
    async fn toggle_skill_unknown_id_errors() {
        let (db, _dir) = test_db().await;
        assert!(db.toggle_skill("no-such-skill").await.is_err());
    }

    #[tokio::test]
    async fn sync_assistant_skills_links_skills_to_assistant() {
        let (db, _dir) = test_db().await;
        let assistant_id = make_assistant(&db).await;
        let s1 = db.create_skill(skill_req("alpha", "user")).await.unwrap();
        let s2 = db.create_skill(skill_req("beta", "user")).await.unwrap();

        db.sync_assistant_skills(&assistant_id, &[s1.id.clone(), s2.id.clone()])
            .await
            .unwrap();

        let mut ids = db.get_assistant_skill_ids(&assistant_id).await.unwrap();
        ids.sort();
        let mut expected = vec![s1.id.clone(), s2.id.clone()];
        expected.sort();
        assert_eq!(ids, expected);

        let mut names: Vec<String> = db
            .get_assistant_skills(&assistant_id)
            .await
            .unwrap()
            .iter()
            .map(|s| s.name.clone())
            .collect();
        names.sort();
        assert_eq!(names, vec!["alpha".to_string(), "beta".to_string()]);
    }

    #[tokio::test]
    async fn sync_assistant_skills_replace_with_disjoint_set() {
        let (db, _dir) = test_db().await;
        let assistant_id = make_assistant(&db).await;
        let s1 = db.create_skill(skill_req("alpha", "user")).await.unwrap();
        let s2 = db.create_skill(skill_req("beta", "user")).await.unwrap();
        let s3 = db.create_skill(skill_req("gamma", "user")).await.unwrap();

        db.sync_assistant_skills(&assistant_id, &[s1.id.clone(), s2.id.clone()])
            .await
            .unwrap();
        // Disjoint replacement succeeds: old junction rows are tombstoned
        // and the new skill is linked.
        db.sync_assistant_skills(&assistant_id, std::slice::from_ref(&s3.id))
            .await
            .unwrap();

        // Reads filter tombstoned junction rows, so only the live link
        // remains visible.
        assert_eq!(
            db.get_assistant_skill_ids(&assistant_id).await.unwrap(),
            vec![s3.id.clone()]
        );
        let names: Vec<String> = db
            .get_assistant_skills(&assistant_id)
            .await
            .unwrap()
            .iter()
            .map(|s| s.name.clone())
            .collect();
        assert_eq!(names, vec!["gamma".to_string()]);
    }

    #[tokio::test]
    async fn sync_assistant_skills_overlapping_set_retains_links() {
        let (db, _dir) = test_db().await;
        let assistant_id = make_assistant(&db).await;
        let s1 = db.create_skill(skill_req("alpha", "user")).await.unwrap();
        let s2 = db.create_skill(skill_req("beta", "user")).await.unwrap();

        db.sync_assistant_skills(&assistant_id, std::slice::from_ref(&s1.id))
            .await
            .unwrap();
        // Retaining s1 while adding s2 must succeed: the retained pair
        // revives its tombstoned row instead of violating the UNIQUE key.
        db.sync_assistant_skills(&assistant_id, &[s1.id.clone(), s2.id.clone()])
            .await
            .unwrap();

        let mut ids = db.get_assistant_skill_ids(&assistant_id).await.unwrap();
        ids.sort();
        let mut expected = vec![s1.id.clone(), s2.id.clone()];
        expected.sort();
        assert_eq!(ids, expected);
    }

    #[tokio::test]
    async fn get_assistant_skill_ids_unknown_assistant_is_empty() {
        let (db, _dir) = test_db().await;
        assert!(
            db.get_assistant_skill_ids("no-such-assistant")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn get_all_assistant_skill_ids_groups_by_assistant() {
        let (db, _dir) = test_db().await;
        let a1 = make_assistant(&db).await;
        let a2 = make_assistant(&db).await;
        let s1 = db.create_skill(skill_req("alpha", "user")).await.unwrap();
        let s2 = db.create_skill(skill_req("beta", "user")).await.unwrap();
        let s3 = db.create_skill(skill_req("gamma", "user")).await.unwrap();

        db.sync_assistant_skills(&a1, std::slice::from_ref(&s1.id))
            .await
            .unwrap();
        db.sync_assistant_skills(&a2, &[s2.id.clone(), s3.id.clone()])
            .await
            .unwrap();

        let map = db.get_all_assistant_skill_ids().await.unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(map.get(&a1), Some(&vec![s1.id.clone()]));
        let mut a2_ids = map.get(&a2).cloned().unwrap_or_default();
        a2_ids.sort();
        let mut a2_expected = vec![s2.id.clone(), s3.id.clone()];
        a2_expected.sort();
        assert_eq!(a2_ids, a2_expected);
    }

    #[tokio::test]
    async fn upsert_skill_by_name_inserts_then_updates_on_hash_change() {
        let (db, _dir) = test_db().await;
        let created = db
            .upsert_skill_by_name(skill_req("scanned", "user"))
            .await
            .unwrap();
        assert_eq!(created.content_hash.as_deref(), Some("hash-v1"));

        let mut changed = skill_req("scanned", "user");
        changed.description = Some("Rescanned description".to_string());
        changed.content_hash = Some("hash-v2".to_string());
        changed.cached_instructions = Some("Instructions v2".to_string());
        let updated = db.upsert_skill_by_name(changed).await.unwrap();

        assert_eq!(updated.id, created.id, "upsert must update in place");
        assert_eq!(updated.content_hash.as_deref(), Some("hash-v2"));
        assert_eq!(
            updated.description.as_deref(),
            Some("Rescanned description")
        );
        assert_eq!(
            updated.cached_instructions.as_deref(),
            Some("Instructions v2")
        );

        let rows = db
            .list_skills()
            .await
            .unwrap()
            .into_iter()
            .filter(|s| s.name == "scanned")
            .count();
        assert_eq!(rows, 1, "upsert must not duplicate the skill");
    }

    #[tokio::test]
    async fn upsert_skill_by_name_skips_update_when_hash_unchanged() {
        let (db, _dir) = test_db().await;
        let created = db
            .upsert_skill_by_name(skill_req("stable", "user"))
            .await
            .unwrap();

        let mut same_hash = skill_req("stable", "user");
        same_hash.description = Some("Should not be written".to_string());
        let result = db.upsert_skill_by_name(same_hash).await.unwrap();

        assert_eq!(result.id, created.id);
        assert_eq!(
            result.description.as_deref(),
            Some("Description for stable"),
            "unchanged hash must leave the row untouched"
        );
    }

    #[tokio::test]
    async fn upsert_skill_by_name_and_source_keys_on_composite() {
        let (db, _dir) = test_db().await;
        let user_row = db
            .upsert_skill_by_name_and_source(skill_req("shared", "user"))
            .await
            .unwrap();
        let claude_row = db
            .upsert_skill_by_name_and_source(skill_req("shared", "claude"))
            .await
            .unwrap();
        assert_ne!(user_row.id, claude_row.id);

        // Updating the user copy must not touch the claude copy.
        let mut changed = skill_req("shared", "user");
        changed.content_hash = Some("hash-v2".to_string());
        changed.description = Some("Updated user copy".to_string());
        let updated = db.upsert_skill_by_name_and_source(changed).await.unwrap();
        assert_eq!(updated.id, user_row.id);
        assert_eq!(updated.content_hash.as_deref(), Some("hash-v2"));

        let claude = db
            .get_skill_by_name_and_source("shared", "claude")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claude.id, claude_row.id);
        assert_eq!(claude.content_hash.as_deref(), Some("hash-v1"));

        // A new (name, source) pair inserts a fresh row.
        let agent_row = db
            .upsert_skill_by_name_and_source(skill_req("shared", "agent"))
            .await
            .unwrap();
        assert_ne!(agent_row.id, user_row.id);
        assert_ne!(agent_row.id, claude_row.id);
    }
}
