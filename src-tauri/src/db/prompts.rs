use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreatePromptRequest, Prompt};

impl Database {
    pub async fn create_prompt(&self, req: CreatePromptRequest) -> Result<Prompt> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_system = req.is_system.unwrap_or(false);

        sqlx::query(
            "INSERT INTO prompts (id, name, content, description, category, is_system, is_starred, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)"
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.content)
        .bind(&req.description)
        .bind(&req.category)
        .bind(if is_system { 1 } else { 0 })
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_prompt(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created prompt"))
    }

    pub async fn get_prompt(&self, id: &str) -> Result<Option<Prompt>> {
        let row = sqlx::query(
            "SELECT id, name, content, description, category, is_system, is_starred, created_at, updated_at
             FROM prompts WHERE prompts.deleted_at IS NULL AND id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => {
                let is_system: i32 = row.get("is_system");
                let is_starred: i32 = row.get("is_starred");
                Ok(Some(Prompt {
                    id: row.get("id"),
                    name: row.get("name"),
                    content: row.get("content"),
                    description: row.get("description"),
                    category: row.get("category"),
                    is_system: is_system != 0,
                    is_starred: is_starred != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn list_prompts(&self) -> Result<Vec<Prompt>> {
        let rows = sqlx::query(
            "SELECT id, name, content, description, category, is_system, is_starred, created_at, updated_at
             FROM prompts WHERE prompts.deleted_at IS NULL ORDER BY category, name",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let prompts = rows
            .into_iter()
            .map(|row| {
                let is_system: i32 = row.get("is_system");
                let is_starred: i32 = row.get("is_starred");
                Prompt {
                    id: row.get("id"),
                    name: row.get("name"),
                    content: row.get("content"),
                    description: row.get("description"),
                    category: row.get("category"),
                    is_system: is_system != 0,
                    is_starred: is_starred != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();

        Ok(prompts)
    }

    pub async fn list_prompts_by_category(&self, category: &str) -> Result<Vec<Prompt>> {
        let rows = sqlx::query(
            "SELECT id, name, content, description, category, is_system, is_starred, created_at, updated_at
             FROM prompts WHERE prompts.deleted_at IS NULL AND category = ? ORDER BY name",
        )
        .bind(category)
        .fetch_all(self.pool.as_ref())
        .await?;

        let prompts = rows
            .into_iter()
            .map(|row| {
                let is_system: i32 = row.get("is_system");
                let is_starred: i32 = row.get("is_starred");
                Prompt {
                    id: row.get("id"),
                    name: row.get("name"),
                    content: row.get("content"),
                    description: row.get("description"),
                    category: row.get("category"),
                    is_system: is_system != 0,
                    is_starred: is_starred != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();

        Ok(prompts)
    }

    pub async fn update_prompt(&self, id: &str, req: CreatePromptRequest) -> Result<Prompt> {
        let now = Utc::now().to_rfc3339();
        let is_system = req.is_system.unwrap_or(false);

        sqlx::query(
            "UPDATE prompts SET name = ?, content = ?, description = ?, category = ?, is_system = ?, updated_at = ?
             WHERE id = ?"
        )
        .bind(&req.name)
        .bind(&req.content)
        .bind(&req.description)
        .bind(&req.category)
        .bind(if is_system { 1 } else { 0 })
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        self.get_prompt(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Prompt not found"))
    }

    pub async fn delete_prompt(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "prompts",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    pub async fn toggle_prompt_star(&self, id: &str) -> Result<Prompt> {
        let now = Utc::now().to_rfc3339();

        sqlx::query("UPDATE prompts SET is_starred = NOT is_starred, updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        self.get_prompt(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Prompt not found"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    fn prompt_req(name: &str) -> CreatePromptRequest {
        CreatePromptRequest {
            name: name.to_string(),
            content: format!("Content of {name}"),
            description: None,
            category: None,
            is_system: None,
        }
    }

    #[tokio::test]
    async fn create_prompt_round_trips_all_fields() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_prompt(CreatePromptRequest {
                name: "Reviewer".to_string(),
                content: "Review the diff carefully.".to_string(),
                description: Some("Code review checklist".to_string()),
                category: Some("work".to_string()),
                is_system: Some(true),
            })
            .await
            .unwrap();

        assert_eq!(created.name, "Reviewer");
        assert_eq!(created.content, "Review the diff carefully.");
        assert_eq!(
            created.description.as_deref(),
            Some("Code review checklist")
        );
        assert_eq!(created.category.as_deref(), Some("work"));
        assert!(created.is_system);
        assert!(!created.is_starred, "new prompts start unstarred");

        let fetched = db.get_prompt(&created.id).await.unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.content, "Review the diff carefully.");
        assert_eq!(
            fetched.description.as_deref(),
            Some("Code review checklist")
        );
        assert_eq!(fetched.category.as_deref(), Some("work"));
        assert!(fetched.is_system);
        assert!(!fetched.is_starred);
    }

    #[tokio::test]
    async fn create_prompt_defaults_to_user_prompt() {
        let (db, _dir) = test_db().await;
        let created = db.create_prompt(prompt_req("Plain")).await.unwrap();
        assert!(!created.is_system);
    }

    #[tokio::test]
    async fn get_prompt_missing_returns_none() {
        let (db, _dir) = test_db().await;
        assert!(db.get_prompt("no-such-id").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_prompts_sorts_by_category_then_name() {
        let (db, _dir) = test_db().await;
        for (name, category) in [
            ("zeta", Some("alpha")),
            ("alpha", Some("alpha")),
            ("solo", Some("zeta")),
            ("uncategorized", None),
        ] {
            let mut req = prompt_req(name);
            req.category = category.map(str::to_string);
            db.create_prompt(req).await.unwrap();
        }

        // SQLite sorts NULL categories first, then by name within a category.
        let names: Vec<String> = db
            .list_prompts()
            .await
            .unwrap()
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(
            names,
            vec!["uncategorized", "alpha", "zeta", "solo"],
            "ordered by category (NULL first) then name"
        );
    }

    #[tokio::test]
    async fn list_prompts_by_category_filters_and_sorts_by_name() {
        let (db, _dir) = test_db().await;
        for (name, category) in [("zeta", "work"), ("alpha", "work"), ("beta", "home")] {
            let mut req = prompt_req(name);
            req.category = Some(category.to_string());
            db.create_prompt(req).await.unwrap();
        }

        let work: Vec<Prompt> = db.list_prompts_by_category("work").await.unwrap();
        let names: Vec<String> = work.iter().map(|p| p.name.clone()).collect();
        assert_eq!(names, vec!["alpha", "zeta"]);
        assert!(work.iter().all(|p| p.category.as_deref() == Some("work")));

        let none = db.list_prompts_by_category("missing").await.unwrap();
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn update_prompt_changes_fields_and_flips_is_system() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_prompt(CreatePromptRequest {
                description: Some("Old description".to_string()),
                category: Some("work".to_string()),
                is_system: Some(true),
                ..prompt_req("Original")
            })
            .await
            .unwrap();

        let updated = db
            .update_prompt(
                &created.id,
                CreatePromptRequest {
                    name: "Renamed".to_string(),
                    content: "New content".to_string(),
                    description: None,
                    category: Some("home".to_string()),
                    is_system: Some(false),
                },
            )
            .await
            .unwrap();

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.content, "New content");
        assert_eq!(updated.description, None);
        assert_eq!(updated.category.as_deref(), Some("home"));
        assert!(!updated.is_system);

        let fetched = db.get_prompt(&created.id).await.unwrap().unwrap();
        assert_eq!(fetched.name, "Renamed");
        assert_eq!(fetched.category.as_deref(), Some("home"));
        assert!(!fetched.is_system);
    }

    #[tokio::test]
    async fn update_prompt_missing_id_is_error() {
        let (db, _dir) = test_db().await;
        assert!(
            db.update_prompt("no-such-id", prompt_req("Ghost"))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn delete_prompt_hides_row_and_wipes_content() {
        let (db, _dir) = test_db().await;
        let created = db.create_prompt(prompt_req("Doomed")).await.unwrap();
        let keeper = db.create_prompt(prompt_req("Keeper")).await.unwrap();

        db.delete_prompt(&created.id).await.unwrap();

        assert!(db.get_prompt(&created.id).await.unwrap().is_none());
        let remaining: Vec<String> = db
            .list_prompts()
            .await
            .unwrap()
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(remaining, vec!["Keeper"]);
        assert!(db.get_prompt(&keeper.id).await.unwrap().is_some());

        // Soft delete keeps the tombstone row with wiped payload.
        let (deleted_at, content): (Option<String>, String) =
            sqlx::query_as("SELECT deleted_at, content FROM prompts WHERE id = ?")
                .bind(&created.id)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert!(deleted_at.is_some());
        assert_eq!(content, "");
    }

    #[tokio::test]
    async fn toggle_prompt_star_flips_both_ways() {
        let (db, _dir) = test_db().await;
        let created = db.create_prompt(prompt_req("Starred")).await.unwrap();
        assert!(!created.is_starred);

        let toggled = db.toggle_prompt_star(&created.id).await.unwrap();
        assert!(toggled.is_starred);

        let toggled_again = db.toggle_prompt_star(&created.id).await.unwrap();
        assert!(!toggled_again.is_starred);
    }

    #[tokio::test]
    async fn toggle_prompt_star_missing_id_is_error() {
        let (db, _dir) = test_db().await;
        assert!(db.toggle_prompt_star("no-such-id").await.is_err());
    }
}
