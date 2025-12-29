//! Database operations for tools (including MCP servers)

use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateToolRequest, Tool};

impl Database {
    /// Create a new tool
    pub async fn create_tool(&self, req: CreateToolRequest) -> Result<Tool> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_enabled = req.is_enabled.unwrap_or(true);

        sqlx::query(
            "INSERT INTO tools (id, name, type, endpoint, config, description, is_enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.r#type)
        .bind(&req.endpoint)
        .bind(&req.config)
        .bind(&req.description)
        .bind(is_enabled as i32)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_tool(&id).await
    }

    /// Get a tool by ID
    pub async fn get_tool(&self, id: &str) -> Result<Tool> {
        let row = sqlx::query(
            "SELECT id, name, type, endpoint, config, description, is_enabled, created_at, updated_at
             FROM tools WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Tool not found: {}", id))?;

        Ok(self.row_to_tool(&row))
    }

    /// List all tools
    pub async fn list_tools(&self) -> Result<Vec<Tool>> {
        let rows = sqlx::query(
            "SELECT id, name, type, endpoint, config, description, is_enabled, created_at, updated_at
             FROM tools ORDER BY created_at DESC",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows.iter().map(|row| self.row_to_tool(row)).collect())
    }

    /// List tools by type (e.g., 'mcp' for MCP servers)
    pub async fn list_tools_by_type(&self, tool_type: &str) -> Result<Vec<Tool>> {
        let rows = sqlx::query(
            "SELECT id, name, type, endpoint, config, description, is_enabled, created_at, updated_at
             FROM tools WHERE type = ? ORDER BY created_at DESC",
        )
        .bind(tool_type)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows.iter().map(|row| self.row_to_tool(row)).collect())
    }

    /// List enabled tools by type
    pub async fn list_enabled_tools_by_type(&self, tool_type: &str) -> Result<Vec<Tool>> {
        let rows = sqlx::query(
            "SELECT id, name, type, endpoint, config, description, is_enabled, created_at, updated_at
             FROM tools WHERE type = ? AND is_enabled = 1 ORDER BY created_at DESC",
        )
        .bind(tool_type)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows.iter().map(|row| self.row_to_tool(row)).collect())
    }

    /// Get tools by their IDs
    pub async fn get_tools_by_ids(&self, ids: &[String]) -> Result<Vec<Tool>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        // Build placeholders for IN clause
        let placeholders: Vec<&str> = ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT id, name, type, endpoint, config, description, is_enabled, created_at, updated_at
             FROM tools WHERE id IN ({}) ORDER BY created_at DESC",
            placeholders.join(", ")
        );

        let mut query_builder = sqlx::query(&query);
        for id in ids {
            query_builder = query_builder.bind(id);
        }

        let rows = query_builder.fetch_all(self.pool.as_ref()).await?;

        Ok(rows.iter().map(|row| self.row_to_tool(row)).collect())
    }

    /// Update a tool
    pub async fn update_tool(&self, id: &str, req: CreateToolRequest) -> Result<Tool> {
        let now = Utc::now().to_rfc3339();
        let is_enabled = req.is_enabled.unwrap_or(true);

        sqlx::query(
            "UPDATE tools SET name = ?, type = ?, endpoint = ?, config = ?, description = ?, is_enabled = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&req.name)
        .bind(&req.r#type)
        .bind(&req.endpoint)
        .bind(&req.config)
        .bind(&req.description)
        .bind(is_enabled as i32)
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        self.get_tool(id).await
    }

    /// Delete a tool
    pub async fn delete_tool(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM tools WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    /// Toggle tool enabled status
    pub async fn toggle_tool_enabled(&self, id: &str) -> Result<Tool> {
        let now = Utc::now().to_rfc3339();

        sqlx::query("UPDATE tools SET is_enabled = NOT is_enabled, updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        self.get_tool(id).await
    }

    fn row_to_tool(&self, row: &sqlx::sqlite::SqliteRow) -> Tool {
        let is_enabled: i32 = row.get("is_enabled");

        Tool {
            id: row.get("id"),
            name: row.get("name"),
            r#type: row.get("type"),
            endpoint: row.get("endpoint"),
            config: row.get("config"),
            description: row.get("description"),
            is_enabled: is_enabled != 0,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }
}

