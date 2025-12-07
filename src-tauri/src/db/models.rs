use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateModelRequest, Model};

impl Database {
    pub async fn create_model(&self, req: CreateModelRequest) -> Result<Model> {
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);

        // Check if a soft-deleted model with same model_id and provider_id exists
        let existing_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM models WHERE model_id = ? AND provider_id = ? AND is_deleted = 1"
        )
        .bind(&req.model_id)
        .bind(&req.provider_id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        if let Some(id) = existing_id {
            // Restore the soft-deleted model
            sqlx::query(
                "UPDATE models SET is_deleted = 0, name = ?, description = ?, is_starred = ?, updated_at = ? WHERE id = ?"
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

        // Create new model
        let id = Uuid::now_v7().to_string();
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
             FROM models WHERE is_deleted = 0 ORDER BY created_at ASC"
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
        sqlx::query("DELETE FROM models WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    pub async fn soft_delete_model(&self, id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE models SET is_deleted = 1, updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }
}

