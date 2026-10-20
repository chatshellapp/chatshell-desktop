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
pub const BUILTIN_KILL_SHELL_ID: &str = "builtin-kill-shell";

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
             FROM tools WHERE id = ? AND deleted_at IS NULL",
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
             FROM tools WHERE deleted_at IS NULL ORDER BY created_at DESC",
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
             FROM tools WHERE id IN ({}) AND deleted_at IS NULL ORDER BY created_at DESC",
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
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "tools",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
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
                BUILTIN_WEB_FETCH_ID,
                "Web Fetch",
                "Fetch and extract content from web pages. Returns cleaned text content suitable for reading articles and documentation.",
            ),
            (
                BUILTIN_WEB_SEARCH_ID,
                "Web Search",
                "Search the web for information using a search engine. Returns relevant search results with titles, URLs, and snippets.",
            ),
            (
                BUILTIN_BASH_ID,
                "Bash",
                "Execute bash commands on the user's system. Enables CLI tools, scripts, and shell operations for skills that require command-line access.",
            ),
            (
                BUILTIN_READ_ID,
                "Read",
                "Read file contents from the filesystem. Supports text files with line numbers, image files (PNG, JPEG, GIF, WebP) with metadata, and PDF text extraction with optional page ranges.",
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
            (
                BUILTIN_KILL_SHELL_ID,
                "Kill Shell",
                "Terminate the current bash session. All state will be lost and a new session will be created on the next bash command.",
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

        // Remove stale builtin tools that are no longer in the canonical list
        let canonical_ids: Vec<&str> = builtin_tools.iter().map(|(id, _, _)| *id).collect();
        let all_builtin_rows = sqlx::query("SELECT id FROM tools WHERE type = ?")
            .bind(TOOL_TYPE_BUILTIN)
            .fetch_all(self.pool.as_ref())
            .await?;
        for row in &all_builtin_rows {
            let id: String = row.get("id");
            if !canonical_ids.contains(&id.as_str()) {
                sqlx::query(&crate::db::soft_delete::tombstone_update(
                    "tools",
                    "id = ?2 AND deleted_at IS NULL",
                ))
                .bind(chrono::Utc::now().to_rfc3339())
                .bind(&id)
                .execute(self.pool.as_ref())
                .await?;
                tracing::info!("🗑️ [db] Removed stale builtin tool: {}", id);
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
            "SELECT id FROM tools WHERE id IN ({}) AND type = ? AND is_enabled = 1 AND deleted_at IS NULL",
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    fn mcp_req(name: &str) -> CreateToolRequest {
        CreateToolRequest {
            name: name.to_string(),
            r#type: TOOL_TYPE_MCP.to_string(),
            endpoint: Some(format!("http://localhost/{name}")),
            config: Some(r#"{"transport":"http"}"#.to_string()),
            description: Some(format!("MCP server {name}")),
            is_enabled: None,
        }
    }

    fn builtin_ids() -> Vec<String> {
        [
            BUILTIN_WEB_FETCH_ID,
            BUILTIN_WEB_SEARCH_ID,
            BUILTIN_BASH_ID,
            BUILTIN_READ_ID,
            BUILTIN_EDIT_ID,
            BUILTIN_WRITE_ID,
            BUILTIN_GREP_ID,
            BUILTIN_GLOB_ID,
            BUILTIN_KILL_SHELL_ID,
        ]
        .iter()
        .map(|s| s.to_string())
        .collect()
    }

    #[tokio::test]
    async fn create_tool_round_trips_all_fields() {
        let (db, _dir) = test_db().await;
        let mut req = mcp_req("filesystem");
        req.is_enabled = Some(false);
        let tool = db.create_tool(req).await.unwrap();

        assert_eq!(tool.name, "filesystem");
        assert_eq!(tool.r#type, TOOL_TYPE_MCP);
        assert_eq!(
            tool.endpoint.as_deref(),
            Some("http://localhost/filesystem")
        );
        assert_eq!(tool.config.as_deref(), Some(r#"{"transport":"http"}"#));
        assert_eq!(tool.description.as_deref(), Some("MCP server filesystem"));
        assert!(!tool.is_enabled, "explicit is_enabled must be honored");
        assert_eq!(tool.auth_token, None, "new tools start without a token");
        assert!(!tool.created_at.is_empty());
        assert!(!tool.updated_at.is_empty());

        let fetched = db.get_tool(&tool.id).await.unwrap();
        assert_eq!(fetched.id, tool.id);
        assert_eq!(fetched.name, "filesystem");
        assert_eq!(
            fetched.endpoint.as_deref(),
            Some("http://localhost/filesystem")
        );
        assert!(!fetched.is_enabled);
    }

    #[tokio::test]
    async fn create_tool_defaults_to_enabled() {
        let (db, _dir) = test_db().await;
        let tool = db.create_tool(mcp_req("defaults")).await.unwrap();
        assert!(tool.is_enabled, "is_enabled must default to true");
    }

    #[tokio::test]
    async fn get_tool_unknown_id_returns_err() {
        let (db, _dir) = test_db().await;
        assert!(db.get_tool("no-such-tool").await.is_err());
    }

    #[tokio::test]
    async fn list_tools_by_type_filters_and_sorts_newest_first() {
        let (db, _dir) = test_db().await;
        let older = db.create_tool(mcp_req("older")).await.unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
        let newer = db.create_tool(mcp_req("newer")).await.unwrap();

        let listed = db.list_tools_by_type(TOOL_TYPE_MCP).await.unwrap();
        assert_eq!(
            listed.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec![newer.id.as_str(), older.id.as_str()],
            "tools must be sorted newest first"
        );

        // The builtin tools seeded by Database::new are a different type and
        // must not leak into the mcp listing.
        assert!(
            listed.iter().all(|t| t.r#type == TOOL_TYPE_MCP),
            "listing must only contain the requested type"
        );
    }

    #[tokio::test]
    async fn list_enabled_tools_by_type_filters_disabled() {
        let (db, _dir) = test_db().await;
        let enabled = db.create_tool(mcp_req("on")).await.unwrap();
        let mut disabled_req = mcp_req("off");
        disabled_req.is_enabled = Some(false);
        let disabled = db.create_tool(disabled_req).await.unwrap();

        let listed = db.list_enabled_tools_by_type(TOOL_TYPE_MCP).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, enabled.id);

        // Once toggled on, the disabled tool appears too.
        db.toggle_tool_enabled(&disabled.id).await.unwrap();
        assert_eq!(
            db.list_enabled_tools_by_type(TOOL_TYPE_MCP)
                .await
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn get_tools_by_ids_returns_subset_and_ignores_missing() {
        let (db, _dir) = test_db().await;
        let t1 = db.create_tool(mcp_req("one")).await.unwrap();
        let _t2 = db.create_tool(mcp_req("two")).await.unwrap();
        let t3 = db.create_tool(mcp_req("three")).await.unwrap();

        let got = db
            .get_tools_by_ids(&[t1.id.clone(), "no-such-tool".to_string(), t3.id.clone()])
            .await
            .unwrap();
        let mut ids: Vec<String> = got.into_iter().map(|t| t.id).collect();
        ids.sort();
        let mut expected = vec![t1.id.clone(), t3.id.clone()];
        expected.sort();
        assert_eq!(ids, expected, "missing ids must be skipped silently");
    }

    #[tokio::test]
    async fn get_tools_by_ids_empty_input_returns_empty() {
        let (db, _dir) = test_db().await;
        assert!(db.get_tools_by_ids(&[]).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn update_tool_persists_changes() {
        let (db, _dir) = test_db().await;
        let tool = db.create_tool(mcp_req("original")).await.unwrap();

        let updated = db
            .update_tool(
                &tool.id,
                CreateToolRequest {
                    name: "renamed".to_string(),
                    r#type: TOOL_TYPE_MCP.to_string(),
                    endpoint: Some("http://localhost:9000".to_string()),
                    config: Some(r#"{"transport":"stdio"}"#.to_string()),
                    description: Some("Renamed server".to_string()),
                    is_enabled: Some(false),
                },
            )
            .await
            .unwrap();

        assert_eq!(updated.id, tool.id);
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.endpoint.as_deref(), Some("http://localhost:9000"));
        assert_eq!(updated.config.as_deref(), Some(r#"{"transport":"stdio"}"#));
        assert_eq!(updated.description.as_deref(), Some("Renamed server"));
        assert!(!updated.is_enabled);

        let refetched = db.get_tool(&tool.id).await.unwrap();
        assert_eq!(refetched.name, "renamed");
        assert!(!refetched.is_enabled);
    }

    #[tokio::test]
    async fn update_tool_unknown_id_errors() {
        let (db, _dir) = test_db().await;
        assert!(
            db.update_tool("no-such-tool", mcp_req("ghost"))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn delete_tool_tombstones_and_hides_from_type_listings() {
        let (db, _dir) = test_db().await;
        let tool = db.create_tool(mcp_req("shortlived")).await.unwrap();
        assert_eq!(db.list_tools_by_type(TOOL_TYPE_MCP).await.unwrap().len(), 1);

        db.delete_tool(&tool.id).await.unwrap();

        // The tombstone wipes the payload columns, so the row no longer
        // matches the type filter.
        assert!(
            db.list_tools_by_type(TOOL_TYPE_MCP)
                .await
                .unwrap()
                .is_empty()
        );
        let tombstoned: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tools WHERE id = ? AND deleted_at IS NOT NULL",
        )
        .bind(&tool.id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(tombstoned, 1, "delete must tombstone, not hard-delete");

        // By-id reads also skip the tombstoned row.
        assert!(db.get_tool(&tool.id).await.is_err());
        assert!(
            db.get_tools_by_ids(std::slice::from_ref(&tool.id))
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn set_all_tools_enabled_scopes_to_type() {
        let (db, _dir) = test_db().await;
        db.create_tool(mcp_req("a")).await.unwrap();
        let mut disabled_req = mcp_req("b");
        disabled_req.is_enabled = Some(false);
        db.create_tool(disabled_req).await.unwrap();

        let result = db
            .set_all_tools_enabled(TOOL_TYPE_MCP, false)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|t| !t.is_enabled));
        assert!(
            db.list_enabled_tools_by_type(TOOL_TYPE_MCP)
                .await
                .unwrap()
                .is_empty()
        );
        // Builtin tools are a different type and stay untouched.
        assert_eq!(
            db.list_enabled_tools_by_type(TOOL_TYPE_BUILTIN)
                .await
                .unwrap()
                .len(),
            builtin_ids().len()
        );

        db.set_all_tools_enabled(TOOL_TYPE_MCP, true).await.unwrap();
        assert_eq!(
            db.list_enabled_tools_by_type(TOOL_TYPE_MCP)
                .await
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn toggle_tool_enabled_flips_state() {
        let (db, _dir) = test_db().await;
        let mut req = mcp_req("flip");
        req.is_enabled = Some(false);
        let tool = db.create_tool(req).await.unwrap();
        assert!(!tool.is_enabled);

        let toggled = db.toggle_tool_enabled(&tool.id).await.unwrap();
        assert!(toggled.is_enabled);
        assert!(db.get_tool(&tool.id).await.unwrap().is_enabled);

        let toggled = db.toggle_tool_enabled(&tool.id).await.unwrap();
        assert!(!toggled.is_enabled);
    }

    #[tokio::test]
    async fn set_tool_auth_token_sets_and_clears() {
        let (db, _dir) = test_db().await;
        let tool = db.create_tool(mcp_req("authed")).await.unwrap();
        assert_eq!(tool.auth_token, None);

        db.set_tool_auth_token(&tool.id, Some("encrypted-token"))
            .await
            .unwrap();
        let stored = db.get_tool(&tool.id).await.unwrap();
        assert_eq!(stored.auth_token.as_deref(), Some("encrypted-token"));
        assert_eq!(stored.name, "authed", "only the token column changes");

        db.set_tool_auth_token(&tool.id, None).await.unwrap();
        assert_eq!(db.get_tool(&tool.id).await.unwrap().auth_token, None);
    }

    #[tokio::test]
    async fn builtin_tools_are_seeded_on_init() {
        let (db, _dir) = test_db().await;
        let builtins = db.list_tools_by_type(TOOL_TYPE_BUILTIN).await.unwrap();

        let mut ids: Vec<String> = builtins.iter().map(|t| t.id.clone()).collect();
        ids.sort();
        let mut expected = builtin_ids();
        expected.sort();
        assert_eq!(ids, expected);
        assert!(builtins.iter().all(|t| t.is_enabled));
        assert!(
            builtins.iter().all(|t| t.r#type == TOOL_TYPE_BUILTIN),
            "seeded rows must be typed builtin"
        );
    }

    #[tokio::test]
    async fn ensure_builtin_tools_is_idempotent() {
        let (db, _dir) = test_db().await;
        db.ensure_builtin_tools().await.unwrap();
        db.ensure_builtin_tools().await.unwrap();

        let builtins = db.list_tools_by_type(TOOL_TYPE_BUILTIN).await.unwrap();
        assert_eq!(builtins.len(), 9, "no duplicate builtin rows");
        let mut names: Vec<String> = builtins.iter().map(|t| t.name.clone()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), 9, "one row per builtin name");
    }

    #[tokio::test]
    async fn ensure_builtin_tools_removes_stale_builtin_tools() {
        let (db, _dir) = test_db().await;
        let stale = db
            .create_tool(CreateToolRequest {
                name: "Legacy Builtin".to_string(),
                r#type: TOOL_TYPE_BUILTIN.to_string(),
                endpoint: None,
                config: None,
                description: Some("Not in the canonical list".to_string()),
                is_enabled: Some(true),
            })
            .await
            .unwrap();
        assert_eq!(
            db.list_tools_by_type(TOOL_TYPE_BUILTIN)
                .await
                .unwrap()
                .len(),
            builtin_ids().len() + 1
        );

        db.ensure_builtin_tools().await.unwrap();

        let builtins = db.list_tools_by_type(TOOL_TYPE_BUILTIN).await.unwrap();
        assert_eq!(
            builtins.len(),
            builtin_ids().len(),
            "stale builtin must be pruned"
        );
        assert!(!builtins.iter().any(|t| t.id == stale.id));
    }

    #[tokio::test]
    async fn get_enabled_builtin_tool_ids_returns_enabled_subset() {
        let (db, _dir) = test_db().await;
        let mut expected = builtin_ids();
        expected.sort();
        let mut got = db
            .get_enabled_builtin_tool_ids(&builtin_ids())
            .await
            .unwrap();
        got.sort();
        assert_eq!(got, expected, "all seeded builtins are enabled");

        // Disabling one builtin drops it from the result.
        db.toggle_tool_enabled(BUILTIN_WEB_SEARCH_ID).await.unwrap();
        let got = db
            .get_enabled_builtin_tool_ids(&[
                BUILTIN_WEB_SEARCH_ID.to_string(),
                BUILTIN_WEB_FETCH_ID.to_string(),
            ])
            .await
            .unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0], BUILTIN_WEB_FETCH_ID);
    }

    #[tokio::test]
    async fn get_enabled_builtin_tool_ids_excludes_non_builtin_and_missing() {
        let (db, _dir) = test_db().await;
        let mcp = db.create_tool(mcp_req("notbuiltin")).await.unwrap();

        let got = db
            .get_enabled_builtin_tool_ids(&[
                mcp.id.clone(),
                BUILTIN_BASH_ID.to_string(),
                "no-such-tool".to_string(),
            ])
            .await
            .unwrap();
        assert_eq!(got, vec![BUILTIN_BASH_ID.to_string()]);
    }

    #[tokio::test]
    async fn get_enabled_builtin_tool_ids_empty_input_returns_empty() {
        let (db, _dir) = test_db().await;
        assert!(
            db.get_enabled_builtin_tool_ids(&[])
                .await
                .unwrap()
                .is_empty()
        );
    }
}
