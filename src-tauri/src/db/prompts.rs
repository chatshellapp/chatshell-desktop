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
             FROM prompts WHERE id = ?",
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
             FROM prompts ORDER BY category, name",
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
             FROM prompts WHERE category = ? ORDER BY name",
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
        sqlx::query("DELETE FROM prompts WHERE id = ?")
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
