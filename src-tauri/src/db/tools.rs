//! Database operations for tools (including MCP servers and builtin tools)

use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateToolRequest, Tool};

/// Tool type constants
pub const TOOL_TYPE_MCP: &str = "mcp";
pub const TOOL_TYPE_BUILTIN: &str = "builtin";

/// Builtin tool IDs (fixed IDs for consistency)
pub const BUILTIN_WEB_SEARCH_ID: &str = "builtin-web-search";
pub const BUILTIN_WEB_FETCH_ID: &str = "builtin-web-fetch";
pub const BUILTIN_BASH_ID: &str = "builtin-bash";
pub const BUILTIN_READ_ID: &str = "builtin-read";
pub const BUILTIN_EDIT_ID: &str = "builtin-edit";
pub const BUILTIN_WRITE_ID: &str = "builtin-write";
pub const BUILTIN_GREP_ID: &str = "builtin-grep";
pub const BUILTIN_GLOB_ID: &str = "builtin-glob";

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
            "SELECT id, name, type, endpoint, config, description, is_enabled, auth_token, created_at, updated_at
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
            "SELECT id, name, type, endpoint, config, description, is_enabled, auth_token, created_at, updated_at
             FROM tools ORDER BY created_at DESC",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows.iter().map(|row| self.row_to_tool(row)).collect())
    }

    /// List tools by type (e.g., 'mcp' for MCP servers)
    pub async fn list_tools_by_type(&self, tool_type: &str) -> Result<Vec<Tool>> {
        let rows = sqlx::query(
            "SELECT id, name, type, endpoint, config, description, is_enabled, auth_token, created_at, updated_at
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
            "SELECT id, name, type, endpoint, config, description, is_enabled, auth_token, created_at, updated_at
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
            "SELECT id, name, type, endpoint, config, description, is_enabled, auth_token, created_at, updated_at
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

    /// Set all tools of a given type to enabled or disabled
    pub async fn set_all_tools_enabled(&self, tool_type: &str, enabled: bool) -> Result<Vec<Tool>> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE tools SET is_enabled = ?, updated_at = ? WHERE type = ?")
            .bind(enabled as i32)
            .bind(&now)
            .bind(tool_type)
            .execute(self.pool.as_ref())
            .await?;

        self.list_tools_by_type(tool_type).await
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
            auth_token: row.get("auth_token"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }

    /// Update only the encrypted auth_token column for an MCP server
    pub async fn set_tool_auth_token(&self, id: &str, encrypted_token: Option<&str>) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE tools SET auth_token = ?, updated_at = ? WHERE id = ?")
            .bind(encrypted_token)
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    /// Ensure builtin tools exist in the database
    /// These are native tools that can be enabled per conversation
    pub async fn ensure_builtin_tools(&self) -> Result<()> {
        let builtin_tools = [
            (
                BUILTIN_WEB_SEARCH_ID,
                "Web Search",
                "Search the web for information using a search engine. Returns relevant search results with titles, URLs, and snippets.",
            ),
            (
                BUILTIN_WEB_FETCH_ID,
                "Web Fetch",
                "Fetch and extract content from web pages. Returns cleaned text content suitable for reading articles and documentation.",
            ),
            (
                BUILTIN_BASH_ID,
                "Bash",
                "Execute bash commands on the user's system. Enables CLI tools, scripts, and shell operations for skills that require command-line access.",
            ),
            (
                BUILTIN_READ_ID,
                "Read",
                "Read file contents from the filesystem. Supports text files with line numbers, image files (PNG, JPEG, GIF, WebP) with metadata, and PDF text extraction.",
            ),
            (
                BUILTIN_EDIT_ID,
                "Edit",
                "Make precise text replacements in files. Specify exact text to find and its replacement. Supports replacing all occurrences for variable renaming.",
            ),
            (
                BUILTIN_WRITE_ID,
                "Write",
                "Create new files or overwrite existing files with provided content. Automatically creates parent directories as needed.",
            ),
            (
                BUILTIN_GREP_ID,
                "Grep",
                "Search file contents using regular expressions. Returns matching lines with file paths and line numbers.",
            ),
            (
                BUILTIN_GLOB_ID,
                "Glob",
                "Find files matching a glob pattern. Returns a list of matching file paths from a directory tree.",
            ),
        ];

        let mut newly_created_ids: Vec<&str> = Vec::new();

        for (id, name, description) in builtin_tools {
            let exists = sqlx::query("SELECT 1 FROM tools WHERE id = ?")
                .bind(id)
                .fetch_optional(self.pool.as_ref())
                .await?
                .is_some();

            if !exists {
                let now = Utc::now().to_rfc3339();
                sqlx::query(
                    "INSERT INTO tools (id, name, type, endpoint, config, description, is_enabled, created_at, updated_at)
                     VALUES (?, ?, ?, NULL, NULL, ?, 1, ?, ?)",
                )
                .bind(id)
                .bind(name)
                .bind(TOOL_TYPE_BUILTIN)
                .bind(description)
                .bind(&now)
                .bind(&now)
                .execute(self.pool.as_ref())
                .await?;

                tracing::info!("✅ [db] Created builtin tool: {}", name);
                newly_created_ids.push(id);
            }
        }

        // Auto-add newly created builtin tools to every assistant that already
        // uses at least one builtin tool, so they're available immediately.
        if !newly_created_ids.is_empty() {
            let assistant_ids: Vec<String> = sqlx::query_scalar(
                "SELECT DISTINCT assistant_id FROM assistant_tools \
                 WHERE tool_id LIKE 'builtin-%'",
            )
            .fetch_all(self.pool.as_ref())
            .await?;

            if !assistant_ids.is_empty() {
                let now = Utc::now().to_rfc3339();
                for assistant_id in &assistant_ids {
                    for tool_id in &newly_created_ids {
                        let already = sqlx::query(
                            "SELECT 1 FROM assistant_tools WHERE assistant_id = ? AND tool_id = ?",
                        )
                        .bind(assistant_id)
                        .bind(tool_id)
                        .fetch_optional(self.pool.as_ref())
                        .await?
                        .is_some();

                        if !already {
                            let id = Uuid::now_v7().to_string();
                            sqlx::query(
                                "INSERT INTO assistant_tools (id, assistant_id, tool_id, created_at) \
                                 VALUES (?, ?, ?, ?)",
                            )
                            .bind(&id)
                            .bind(assistant_id)
                            .bind(tool_id)
                            .bind(&now)
                            .execute(self.pool.as_ref())
                            .await?;
                        }
                    }
                }
                tracing::info!(
                    "✅ [db] Auto-added {} new builtin tool(s) to {} assistant(s)",
                    newly_created_ids.len(),
                    assistant_ids.len()
                );
            }
        }

        Ok(())
    }

    /// Get enabled builtin tool IDs from a list of tool IDs
    pub async fn get_enabled_builtin_tool_ids(&self, ids: &[String]) -> Result<Vec<String>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        // Filter to only builtin tools
        let placeholders: Vec<&str> = ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT id FROM tools WHERE id IN ({}) AND type = ? AND is_enabled = 1",
            placeholders.join(", ")
        );

        let mut query_builder = sqlx::query_scalar::<_, String>(&query);
        for id in ids {
            query_builder = query_builder.bind(id);
        }
        query_builder = query_builder.bind(TOOL_TYPE_BUILTIN);

        let rows = query_builder.fetch_all(self.pool.as_ref()).await?;
        Ok(rows)
    }
}
