use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid;

use super::Database;
use crate::models::{CreateModelRequest, Model};

impl Database {
    pub async fn create_model(&self, req: CreateModelRequest) -> Result<Model> {
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);

        // Natural-key singleton: a live row with the same (provider_id,
        // model_id) IS this model — update it in place instead of creating
        // a duplicate (two rows for one model broke the pickers and, across
        // devices, the merge duplicated defaults; real-device finding).
        let existing_live: Option<String> = sqlx::query_scalar(
            "SELECT id FROM models WHERE model_id = ? AND provider_id = ? \
             AND deleted_at IS NULL AND is_deleted = 0",
        )
        .bind(&req.model_id)
        .bind(&req.provider_id)
        .fetch_optional(self.pool.as_ref())
        .await?;
        if let Some(id) = existing_live {
            sqlx::query(
                "UPDATE models SET name = ?, description = ?, is_starred = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&req.name)
            .bind(&req.description)
            .bind(is_starred as i32)
            .bind(&now)
            .bind(&id)
            .execute(self.pool.as_ref())
            .await?;
            return self
                .get_model(&id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("Failed to retrieve existing model"));
        }

        // Check if a soft-deleted model with same model_id and provider_id exists
        let existing_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM models WHERE model_id = ? AND provider_id = ? \
             AND (deleted_at IS NOT NULL OR is_deleted = 1)",
        )
        .bind(&req.model_id)
        .bind(&req.provider_id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        if let Some(id) = existing_id {
            // Restore the soft-deleted model. Clearing `deleted_at` is part
            // of the restore: a row left with `is_deleted = 0` and a stale
            // tombstone would contradict every read path that filters
            // `deleted_at IS NULL` (the canonical mechanism since the
            // tombstone migration; `is_deleted` is legacy-only).
            sqlx::query(
                "UPDATE models SET is_deleted = 0, deleted_at = NULL, name = ?, description = ?, is_starred = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&req.name)
            .bind(&req.description)
            .bind(is_starred as i32)
            .bind(&now)
            .bind(&id)
            .execute(self.pool.as_ref())
            .await?;

            return self
                .get_model(&id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("Failed to retrieve restored model"));
        }

        // Deterministic id (UUID v5 over provider+model): devices adding
        // the same model to the same (deterministic-id) provider produce
        // the same row, so merges converge instead of duplicating
        // (system-seed rule; custom providers differ per device anyway).
        let id = super::system_ids::system_uuid(&format!(
            "chatshell.model.{}.{}",
            req.provider_id, req.model_id
        ));
        // A dead row holding the deterministic id (deleted-then-recreated
        // same logical model) is replaced outright: the live rewrite wins
        // LWW on peers. A LIVE row with this id was handled above.
        sqlx::query(
            "DELETE FROM models WHERE id = ? AND (deleted_at IS NOT NULL OR is_deleted = 1)",
        )
        .bind(&id)
        .execute(self.pool.as_ref())
        .await?;
        sqlx::query(
            "INSERT INTO models (id, name, provider_id, model_id, description, is_starred, is_deleted, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)"
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.provider_id)
        .bind(&req.model_id)
        .bind(&req.description)
        .bind(is_starred as i32)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_model(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created model"))
    }

    pub async fn get_model(&self, id: &str) -> Result<Option<Model>> {
        let row = sqlx::query(
            "SELECT id, name, provider_id, model_id, description, is_starred, is_deleted, created_at, updated_at
             FROM models WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => {
                let is_starred: i32 = row.get("is_starred");
                let is_deleted: i32 = row.get("is_deleted");

                Ok(Some(Model {
                    id: row.get("id"),
                    name: row.get("name"),
                    provider_id: row.get("provider_id"),
                    model_id: row.get("model_id"),
                    description: row.get("description"),
                    is_starred: is_starred != 0,
                    is_deleted: is_deleted != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn list_models(&self) -> Result<Vec<Model>> {
        let rows = sqlx::query(
            "SELECT id, name, provider_id, model_id, description, is_starred, is_deleted, created_at, updated_at
             FROM models WHERE deleted_at IS NULL ORDER BY created_at ASC"
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let models = rows
            .iter()
            .map(|row| {
                let is_starred: i32 = row.get("is_starred");
                let is_deleted: i32 = row.get("is_deleted");

                Model {
                    id: row.get("id"),
                    name: row.get("name"),
                    provider_id: row.get("provider_id"),
                    model_id: row.get("model_id"),
                    description: row.get("description"),
                    is_starred: is_starred != 0,
                    is_deleted: is_deleted != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();

        Ok(models)
    }

    pub async fn list_all_models(&self) -> Result<Vec<Model>> {
        let rows = sqlx::query(
            "SELECT id, name, provider_id, model_id, description, is_starred, is_deleted, created_at, updated_at
             FROM models ORDER BY created_at ASC"
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let models = rows
            .iter()
            .map(|row| {
                let is_starred: i32 = row.get("is_starred");
                let is_deleted: i32 = row.get("is_deleted");

                Model {
                    id: row.get("id"),
                    name: row.get("name"),
                    provider_id: row.get("provider_id"),
                    model_id: row.get("model_id"),
                    description: row.get("description"),
                    is_starred: is_starred != 0,
                    is_deleted: is_deleted != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();

        Ok(models)
    }

    pub async fn update_model(&self, id: &str, req: CreateModelRequest) -> Result<Model> {
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);

        sqlx::query(
            "UPDATE models SET name = ?, provider_id = ?, model_id = ?, description = ?, is_starred = ?, updated_at = ? WHERE id = ?"
        )
        .bind(&req.name)
        .bind(&req.provider_id)
        .bind(&req.model_id)
        .bind(&req.description)
        .bind(is_starred as i32)
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        self.get_model(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Model not found"))
    }

    pub async fn delete_model(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "models",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
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
        // models.provider_id has an enforced FK to providers.
        sqlx::query(
            "INSERT INTO providers (id, name, provider_type, created_at, updated_at) \
             VALUES ('prov-1', 'Test Provider', 'openai', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        (db, dir)
    }

    fn req(model_id: &str) -> CreateModelRequest {
        CreateModelRequest {
            name: format!("Model {model_id}"),
            provider_id: "prov-1".into(),
            model_id: model_id.into(),
            description: None,
            is_starred: None,
        }
    }

    async fn raw_row(db: &Database, id: &str) -> (String, String, i32, Option<String>) {
        // (name, model_id, is_deleted, deleted_at)
        sqlx::query_as("SELECT name, model_id, is_deleted, deleted_at FROM models WHERE id = ?")
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn delete_model_tombstones_wipes_payload_and_hides() {
        let (db, _dir) = test_db().await;
        let created = db.create_model(req("gpt-x")).await.unwrap();

        db.delete_model(&created.id).await.unwrap();

        // Row survives as an identity-skeleton tombstone (merge propagation)
        // and disappears from the canonical live listing.
        let (name, model_id, is_deleted, deleted_at) = raw_row(&db, &created.id).await;
        assert_eq!(name, "");
        assert_eq!(model_id, "");
        assert_eq!(is_deleted, 1);
        assert!(deleted_at.is_some(), "tombstone timestamp must be set");
        assert!(db.list_models().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn create_model_restores_legacy_flag_row_and_clears_tombstone() {
        let (db, _dir) = test_db().await;
        let created = db.create_model(req("gpt-x")).await.unwrap();

        // Legacy deletion shape (pre-tombstone `soft_delete_model`): flag
        // set, `deleted_at` still NULL.
        sqlx::query("UPDATE models SET is_deleted = 1 WHERE id = ?")
            .bind(&created.id)
            .execute(db.pool())
            .await
            .unwrap();

        let restored = db.create_model(req("gpt-x")).await.unwrap();
        assert_eq!(restored.id, created.id, "restore path reuses the row");

        let (name, _model_id, is_deleted, deleted_at) = raw_row(&db, &created.id).await;
        assert_eq!(name, "Model gpt-x");
        assert_eq!(is_deleted, 0);
        assert!(deleted_at.is_none(), "restore must clear the tombstone");
    }

    #[tokio::test]
    async fn create_model_after_tombstone_reuses_deterministic_id() {
        let (db, _dir) = test_db().await;
        let first = db.create_model(req("gpt-x")).await.unwrap();
        db.delete_model(&first.id).await.unwrap();

        // The tombstone wipe blanked model_id, so the natural-key lookups
        // cannot match it; re-adding the same logical model computes the
        // same DETERMINISTIC id, replaces the dead row, and one live row
        // remains (cross-device adds converge on the same id).
        let second = db.create_model(req("gpt-x")).await.unwrap();
        assert_eq!(
            second.id, first.id,
            "deterministic id is the model identity"
        );

        let (_, _, is_deleted, deleted_at) = raw_row(&db, &first.id).await;
        assert_eq!(is_deleted, 0);
        assert!(deleted_at.is_none(), "recreated row must be live");

        let live = db.list_models().await.unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].id, second.id);
    }
}
