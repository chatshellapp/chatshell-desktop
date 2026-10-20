//! MCP Connection Manager
//!
//! Manages connections to MCP servers via Streamable HTTP and STDIO transports.

use anyhow::{Context, Result};
use rmcp::model::{ClientCapabilities, ClientInfo, Implementation, Tool as McpTool};
use rmcp::service::{Peer, RunningService};
use rmcp::transport::TokioChildProcess;
use rmcp::{RoleClient, ServiceExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use chatshell_agent_core::mcp::{self as core_mcp, connect_http_service};

use crate::models::{McpAuthType, McpConfig, McpTransportType, Tool};

/// Type alias for the running MCP client service
type McpRunningService = RunningService<RoleClient, ClientInfo>;

/// Represents an active connection to an MCP server
/// Note: This struct is Clone but the running_service is wrapped in Arc for shared ownership.
/// The RunningService must be kept alive for the connection to remain active.
pub struct McpServerConnection {
    /// The tool configuration from database
    pub tool: Tool,
    /// Available tools from this MCP server
    pub mcp_tools: Vec<McpTool>,
    /// The client peer for calling tools (derived from running_service)
    pub client: Peer<RoleClient>,
    /// The running service that keeps the connection alive
    /// IMPORTANT: This MUST be kept alive for the connection to work.
    /// Dropping this will cancel the background transport task.
    _running_service: Arc<McpRunningService>,
}

impl Clone for McpServerConnection {
    fn clone(&self) -> Self {
        Self {
            tool: self.tool.clone(),
            mcp_tools: self.mcp_tools.clone(),
            client: self.client.clone(),
            _running_service: Arc::clone(&self._running_service),
        }
    }
}

/// A server that failed to connect, with the error message.
pub struct ConnectFailure {
    pub tool_id: String,
    pub error: String,
}

/// Result of connecting to multiple MCP servers.
pub struct ConnectMultipleResult {
    pub connections: Vec<(McpServerConnection, Vec<McpTool>)>,
    pub failures: Vec<ConnectFailure>,
}

/// Manager for MCP server connections
#[derive(Default)]
pub struct McpConnectionManager {
    /// Cache of active connections by tool ID
    connections: Arc<RwLock<HashMap<String, McpServerConnection>>>,
}

impl McpConnectionManager {
    /// Create a new MCP connection manager
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create the standard client info for MCP connections
    fn create_client_info() -> ClientInfo {
        ClientInfo::new(
            ClientCapabilities::default(),
            Implementation::new("chatshell", env!("CARGO_PKG_VERSION")),
        )
    }

    /// Resolve HTTP auth header from the tool's encrypted `auth_token` column.
    /// All secrets are decrypted from SQLite using the in-memory master key,
    /// so this never triggers the macOS keychain authorization dialog.
    fn get_http_auth_header(tool: &Tool) -> Result<Option<String>> {
        let config = match tool.parse_mcp_config() {
            Some(c) => c,
            None => return Ok(None),
        };
        let auth_type = config.auth_type.unwrap_or(McpAuthType::None);
        match auth_type {
            McpAuthType::None => Ok(None),
            McpAuthType::Bearer => {
                let encrypted = match &tool.auth_token {
                    Some(t) => t,
                    None => return Ok(None),
                };
                let token = crate::crypto::decrypt(encrypted)
                    .context("Failed to decrypt MCP bearer token")?;
                Ok(Some(token))
            }
            McpAuthType::Oauth => {
                let encrypted = match &tool.auth_token {
                    Some(t) => t,
                    None => {
                        anyhow::bail!(
                            "OAuth token not found for MCP server. Please re-authorize in Settings (MCP server: {}).",
                            tool.name
                        );
                    }
                };
                let json_str = crate::crypto::decrypt(encrypted)
                    .context("Failed to decrypt MCP OAuth token")?;
                let parsed: serde_json::Value =
                    serde_json::from_str(&json_str).context("Invalid OAuth token JSON")?;
                let access_token = parsed["access_token"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("Missing access_token in OAuth data"))?;
                Ok(Some(access_token.to_string()))
            }
        }
    }

    /// Connect to an MCP server via HTTP transport.
    ///
    /// Transport construction (client, headers, auth, client identity) is the
    /// shared core layer (`connect_http_service`); desktop adds nothing on
    /// top of it.
    async fn connect_http(
        &self,
        endpoint: &str,
        auth_header: Option<String>,
        custom_headers: Option<&HashMap<String, String>>,
    ) -> Result<McpRunningService> {
        tracing::info!("🌐 Connecting via HTTP to: {}", endpoint);

        let config = core_mcp::McpHttpConfig {
            endpoint: endpoint.to_string(),
            auth_token: auth_header,
            custom_headers: custom_headers.cloned().unwrap_or_default(),
        };
        connect_http_service(&config).await
    }

    /// Connect to an MCP server via STDIO transport
    async fn connect_stdio(&self, config: &McpConfig) -> Result<McpRunningService> {
        let command_str = config
            .command
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("STDIO transport requires a command"))?;

        tracing::info!("🖥️ Connecting via STDIO: {}", command_str);

        // Parse the command string - it may contain the executable and arguments
        // e.g., "npx -y @modelcontextprotocol/server-everything"
        let parsed_parts: Vec<String> =
            shell_words::split(command_str).unwrap_or_else(|_| vec![command_str.to_string()]);

        let (executable, command_args): (String, Vec<String>) = if parsed_parts.len() > 1 {
            // Command string contains arguments
            let exe = parsed_parts[0].clone();
            let args: Vec<String> = parsed_parts[1..].to_vec();
            tracing::debug!("  Parsed executable: {}", exe);
            tracing::debug!("  Parsed command args: {:?}", args);
            (exe, args)
        } else {
            // Command is just the executable
            (command_str.clone(), Vec::new())
        };

        // Build the command using tokio::process::Command
        let mut cmd = tokio::process::Command::new(&executable);

        // Add arguments parsed from command string
        if !command_args.is_empty() {
            cmd.args(&command_args);
        }

        // Add additional arguments if specified in config
        if let Some(args) = &config.args {
            cmd.args(args);
            tracing::debug!("  Additional config args: {:?}", args);
        }

        // Set working directory
        // Default to home directory if not specified, fail if neither is available
        let cwd = match config.cwd.clone() {
            Some(dir) => dir,
            None => dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "No working directory specified and home directory unavailable. \
                         Please specify a working directory in the MCP server configuration."
                    )
                })?,
        };
        cmd.current_dir(&cwd);
        tracing::debug!("  Working directory: {}", cwd);

        // Set up environment variables
        // SECURITY: Clear the inherited environment and start fresh to avoid exposing
        // sensitive variables from the parent process. Only include essential system
        // variables and explicitly configured custom variables.
        cmd.env_clear();

        // Use resolved shell PATH (includes nvm, homebrew, etc.) instead of
        // the potentially minimal PATH inherited by macOS GUI apps.
        let path = super::resolve_shell_path()
            .or_else(|| std::env::var("PATH").ok())
            .unwrap_or_else(|| "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string());
        cmd.env("PATH", &path);
        tracing::debug!("  PATH for child process: {}", path);

        let other_essential_vars = ["HOME", "USER", "SHELL", "LANG", "LC_ALL", "TERM"];
        for var in other_essential_vars {
            if let Ok(value) = std::env::var(var) {
                cmd.env(var, value);
            }
        }
        if let Some(env_vars) = &config.env {
            if env_vars.is_empty() {
                tracing::info!("  No custom env vars (empty map)");
            } else {
                cmd.envs(env_vars);
                tracing::info!(
                    "  Applied {} custom env var(s): {:?}",
                    env_vars.len(),
                    env_vars.keys().collect::<Vec<_>>()
                );
            }
        } else {
            tracing::info!("  No custom env vars configured");
        }

        // Create STDIO transport from the command
        // TokioChildProcess will handle stdin/stdout configuration
        let transport = TokioChildProcess::new(cmd).context(format!(
            "Failed to create STDIO transport for: {}",
            command_str
        ))?;

        tracing::info!("✅ Created STDIO transport for MCP server");

        // Connect using the transport
        let client_info = Self::create_client_info();
        let running_service = client_info
            .serve(transport)
            .await
            .context("Failed to establish MCP connection via STDIO")?;

        Ok(running_service)
    }

    /// Connect to an MCP server and retrieve its tools
    pub async fn connect(&self, tool: &Tool) -> Result<McpServerConnection> {
        let config = tool.parse_mcp_config();
        let transport_type = config
            .as_ref()
            .map(|c| c.transport)
            .unwrap_or(McpTransportType::Http);

        tracing::info!(
            "🔌 Connecting to MCP server: {} (transport: {:?})",
            tool.name,
            transport_type
        );

        // Connect based on transport type
        let running_service = match transport_type {
            McpTransportType::Http => {
                let endpoint = tool
                    .endpoint
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("HTTP transport requires an endpoint URL"))?;
                let auth_header = Self::get_http_auth_header(tool)?;
                let custom_headers = config.as_ref().and_then(|c| c.headers.as_ref());
                tracing::debug!(
                    "🔐 HTTP auth for {}: {}, custom headers: {}",
                    tool.name,
                    if auth_header.is_some() {
                        "token present"
                    } else {
                        "none"
                    },
                    custom_headers.map(|h| h.len()).unwrap_or(0)
                );
                self.connect_http(endpoint, auth_header, custom_headers)
                    .await?
            }
            McpTransportType::Stdio => {
                let mcp_config =
                    config.ok_or_else(|| anyhow::anyhow!("STDIO transport requires a config"))?;
                self.connect_stdio(&mcp_config).await?
            }
        };

        // Get server info for logging
        if let Some(server_info) = running_service.peer_info() {
            tracing::info!(
                "✅ Connected to MCP server: {:?}",
                server_info.server_info.name
            );
        } else {
            tracing::info!("✅ Connected to MCP server (no server info available)");
        }

        // List available tools
        let tools_result = running_service
            .list_tools(Default::default())
            .await
            .context("Failed to list tools from MCP server")?;

        let mcp_tools = tools_result.tools;
        tracing::info!(
            "📦 Found {} tools from MCP server {}",
            mcp_tools.len(),
            tool.name
        );

        for mcp_tool in &mcp_tools {
            tracing::info!("   - {}: {:?}", mcp_tool.name, mcp_tool.description);
        }

        // Clone the peer before wrapping in Arc (peer is Clone)
        let client_peer = running_service.peer().clone();

        let connection = McpServerConnection {
            tool: tool.clone(),
            mcp_tools,
            client: client_peer,
            _running_service: Arc::new(running_service),
        };

        // Cache the connection
        {
            let mut connections = self.connections.write().await;
            connections.insert(tool.id.clone(), connection.clone());
        }

        Ok(connection)
    }

    /// Get a cached connection or create a new one.
    /// Validates cached connections by re-listing tools to detect stale auth tokens.
    pub async fn get_or_connect(&self, tool: &Tool) -> Result<McpServerConnection> {
        // Check cache first
        let cached = {
            let connections = self.connections.read().await;
            connections.get(&tool.id).cloned()
        };

        if let Some(conn) = cached {
            // Validate the cached connection is still alive
            match conn._running_service.list_tools(Default::default()).await {
                Ok(tools_result) => {
                    // Update cached tools in case they changed
                    let mut updated = conn.clone();
                    updated.mcp_tools = tools_result.tools;
                    {
                        let mut connections = self.connections.write().await;
                        connections.insert(tool.id.clone(), updated.clone());
                    }
                    return Ok(updated);
                }
                Err(e) => {
                    tracing::warn!(
                        "⚠️ Cached connection for '{}' is stale, reconnecting: {}",
                        tool.name,
                        e
                    );
                    self.disconnect(&tool.id).await;
                }
            }
        }

        // Create new connection
        self.connect(tool).await
    }

    /// Disconnect from an MCP server
    pub async fn disconnect(&self, tool_id: &str) {
        let mut connections = self.connections.write().await;
        if connections.remove(tool_id).is_some() {
            tracing::info!("🔌 Disconnected from MCP server: {}", tool_id);
        }
    }

    /// Disconnect from all MCP servers
    pub async fn disconnect_all(&self) {
        let mut connections = self.connections.write().await;
        let count = connections.len();
        connections.clear();
        tracing::info!("🔌 Disconnected from {} MCP server(s)", count);
    }

    /// Get all active connections
    pub async fn get_active_connections(&self) -> Vec<McpServerConnection> {
        let connections = self.connections.read().await;
        connections.values().cloned().collect()
    }

    /// Connect to multiple MCP servers and collect all tools
    pub async fn connect_multiple(&self, tools: &[Tool]) -> Result<ConnectMultipleResult> {
        let mut connections = Vec::new();
        let mut failures = Vec::new();

        for tool in tools {
            match self.get_or_connect(tool).await {
                Ok(conn) => {
                    let mcp_tools = conn.mcp_tools.clone();
                    connections.push((conn, mcp_tools));
                }
                Err(e) => {
                    let error_str = e.to_string();
                    tracing::warn!(
                        "⚠️ Failed to connect to MCP server {}: {}",
                        tool.name,
                        error_str
                    );
                    failures.push(ConnectFailure {
                        tool_id: tool.id.clone(),
                        error: error_str,
                    });
                }
            }
        }

        Ok(ConnectMultipleResult {
            connections,
            failures,
        })
    }

    /// Test connection to an MCP server via HTTP
    pub async fn test_http_connection(&self, endpoint: &str) -> Result<Vec<McpTool>> {
        tracing::info!("🧪 Testing HTTP connection to: {}", endpoint);

        let running_service = self.connect_http(endpoint, None, None).await?;

        let tools_result = running_service
            .list_tools(Default::default())
            .await
            .context("Failed to list tools from MCP server")?;

        tracing::info!(
            "✅ HTTP test successful: found {} tools",
            tools_result.tools.len()
        );

        Ok(tools_result.tools)
    }

    /// Test connection to an MCP server via STDIO
    pub async fn test_stdio_connection(&self, config: &McpConfig) -> Result<Vec<McpTool>> {
        tracing::info!("🧪 Testing STDIO connection: {:?}", config.command);

        let running_service = self.connect_stdio(config).await?;

        let tools_result = running_service
            .list_tools(Default::default())
            .await
            .context("Failed to list tools from MCP server")?;

        tracing::info!(
            "✅ STDIO test successful: found {} tools",
            tools_result.tools.len()
        );

        Ok(tools_result.tools)
    }

    /// Test connection to an MCP server (auto-detect transport type)
    pub async fn test_connection(&self, endpoint: &str) -> Result<Vec<McpTool>> {
        self.test_http_connection(endpoint).await
    }
}

/// Sanitize a string for use as a directory or file name.
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_ascii_control() => '_',
            c => c,
        })
        .collect()
}

/// Sync MCP tool definitions to JSON files for dynamic context discovery.
///
/// Creates one JSON file per tool under `base_dir/<server_name>/`, containing
/// the tool's name, description, and full inputSchema. The agent can then read
/// these files on demand instead of having all schemas in every API call.
///
/// Removes any existing files for the server before writing to avoid stale
/// definitions from previous connections.
pub fn sync_tool_definitions(
    base_dir: &std::path::Path,
    server_name: &str,
    mcp_tools: &[McpTool],
) -> Result<std::path::PathBuf> {
    let server_dir = base_dir.join(sanitize_name(server_name));

    if server_dir.exists() {
        std::fs::remove_dir_all(&server_dir)
            .context("Failed to remove stale MCP tool definitions")?;
    }
    std::fs::create_dir_all(&server_dir)
        .context("Failed to create MCP tool definitions directory")?;

    for tool in mcp_tools {
        let file_name = format!("{}.json", sanitize_name(&tool.name));
        let file_path = server_dir.join(&file_name);
        let definition = serde_json::json!({
            "name": tool.name,
            "description": tool.description,
            "inputSchema": tool.input_schema,
        });
        let json_str = serde_json::to_string_pretty(&definition)
            .context("Failed to serialize MCP tool definition")?;
        std::fs::write(&file_path, json_str)
            .with_context(|| format!("Failed to write tool definition: {}", file_path.display()))?;
    }

    tracing::info!(
        "📄 Synced {} tool definition(s) to {}",
        mcp_tools.len(),
        server_dir.display()
    );

    Ok(server_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_tool(
        id: &str,
        name: &str,
        endpoint: Option<&str>,
        config: Option<&str>,
        auth_token: Option<String>,
    ) -> Tool {
        Tool {
            id: id.to_string(),
            name: name.to_string(),
            r#type: "mcp".to_string(),
            endpoint: endpoint.map(str::to_string),
            config: config.map(str::to_string),
            description: None,
            is_enabled: true,
            auth_token,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn mcp_tool(name: &str, description: Option<&str>) -> McpTool {
        let value = json!({
            "name": name,
            "description": description,
            "inputSchema": {
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "required": ["query"],
            },
        });
        serde_json::from_value(value).unwrap()
    }

    fn install_test_keys() {
        crate::crypto::set_keys_for_tests([0x5a; 32], None);
    }

    // ---- sanitize_name ----

    #[test]
    fn sanitize_name_maps_forbidden_characters_to_underscores() {
        assert_eq!(
            sanitize_name(r#"a/b\c:d*e?f"g<h>i|j"#),
            "a_b_c_d_e_f_g_h_i_j"
        );
    }

    #[test]
    fn sanitize_name_maps_ascii_control_characters() {
        assert_eq!(sanitize_name("a\tb\nc\0d\u{7f}"), "a_b_c_d_");
    }

    #[test]
    fn sanitize_name_keeps_safe_characters() {
        assert_eq!(sanitize_name("My Server 01"), "My Server 01");
        assert_eq!(sanitize_name("服务器"), "服务器");
        assert_eq!(sanitize_name(""), "");
    }

    // ---- sync_tool_definitions ----

    #[test]
    fn sync_tool_definitions_writes_one_pretty_json_per_tool() {
        let dir = tempfile::tempdir().unwrap();
        let tools = vec![
            mcp_tool("web_search", Some("Search the web")),
            mcp_tool("read/file", None),
        ];

        let out = sync_tool_definitions(dir.path(), "search_server", &tools).unwrap();
        assert_eq!(out, dir.path().join("search_server"));
        assert_eq!(std::fs::read_dir(&out).unwrap().count(), 2);

        let search = std::fs::read_to_string(out.join("web_search.json")).unwrap();
        assert!(search.contains('\n'), "definition should be pretty-printed");
        let value: serde_json::Value = serde_json::from_str(&search).unwrap();
        assert_eq!(value["name"], "web_search");
        assert_eq!(value["description"], "Search the web");
        assert_eq!(value["inputSchema"]["type"], "object");
        assert_eq!(
            value["inputSchema"]["properties"]["query"]["type"],
            "string"
        );
        assert_eq!(value["inputSchema"]["required"], json!(["query"]));

        // Tool names are sanitized into file names; missing description is null.
        let fetch = std::fs::read_to_string(out.join("read_file.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&fetch).unwrap();
        assert_eq!(value["name"], "read/file");
        assert_eq!(value["description"], serde_json::Value::Null);
    }

    #[test]
    fn sync_tool_definitions_removes_stale_files_and_sanitizes_server_name() {
        let dir = tempfile::tempdir().unwrap();
        let server_dir = dir.path().join("a_b_c");
        std::fs::create_dir_all(&server_dir).unwrap();
        std::fs::write(server_dir.join("stale.json"), "stale").unwrap();

        let out = sync_tool_definitions(
            dir.path(),
            "a:b/c",
            &[mcp_tool("only_one", Some("The only tool"))],
        )
        .unwrap();
        assert_eq!(out, server_dir);
        assert!(!server_dir.join("stale.json").exists());
        let names: Vec<String> = std::fs::read_dir(&out)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["only_one.json".to_string()]);
    }

    #[test]
    fn sync_tool_definitions_with_no_tools_creates_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let out = sync_tool_definitions(dir.path(), "empty", &[]).unwrap();
        assert_eq!(std::fs::read_dir(&out).unwrap().count(), 0);
    }

    // ---- create_client_info ----

    #[test]
    fn create_client_info_uses_chatshell_identity_and_crate_version() {
        let info = McpConnectionManager::create_client_info();
        assert_eq!(info.client_info.name, "chatshell");
        assert_eq!(info.client_info.version, env!("CARGO_PKG_VERSION"));
    }

    // ---- get_http_auth_header ----

    #[test]
    fn get_http_auth_header_returns_none_without_config() {
        let tool = make_tool("t1", "No Config", None, None, None);
        assert_eq!(
            McpConnectionManager::get_http_auth_header(&tool).unwrap(),
            None
        );
    }

    #[test]
    fn get_http_auth_header_returns_none_for_auth_type_none() {
        let tool = make_tool(
            "t1",
            "No Auth",
            None,
            Some(r#"{"transport":"http","auth_type":"none"}"#),
            None,
        );
        assert_eq!(
            McpConnectionManager::get_http_auth_header(&tool).unwrap(),
            None
        );
    }

    #[test]
    fn get_http_auth_header_returns_none_for_bearer_without_stored_token() {
        let tool = make_tool(
            "t1",
            "Bearer No Token",
            None,
            Some(r#"{"transport":"http","auth_type":"bearer"}"#),
            None,
        );
        assert_eq!(
            McpConnectionManager::get_http_auth_header(&tool).unwrap(),
            None
        );
    }

    #[test]
    fn get_http_auth_header_decrypts_bearer_token() {
        install_test_keys();
        let encrypted = crate::crypto::encrypt("tok-secret-123").unwrap();
        let tool = make_tool(
            "t1",
            "Bearer",
            None,
            Some(r#"{"transport":"http","auth_type":"bearer"}"#),
            Some(encrypted),
        );
        assert_eq!(
            McpConnectionManager::get_http_auth_header(&tool).unwrap(),
            Some("tok-secret-123".to_string())
        );
    }

    #[test]
    fn get_http_auth_header_extracts_access_token_from_oauth_json() {
        install_test_keys();
        let encrypted =
            crate::crypto::encrypt(r#"{"access_token":"at-xyz","refresh_token":"rt"}"#).unwrap();
        let tool = make_tool(
            "t1",
            "Oauth",
            None,
            Some(r#"{"transport":"http","auth_type":"oauth"}"#),
            Some(encrypted),
        );
        assert_eq!(
            McpConnectionManager::get_http_auth_header(&tool).unwrap(),
            Some("at-xyz".to_string())
        );
    }

    #[test]
    fn get_http_auth_header_bails_when_oauth_token_missing() {
        let tool = make_tool(
            "t1",
            "Oauth No Token",
            None,
            Some(r#"{"transport":"http","auth_type":"oauth"}"#),
            None,
        );
        let err = McpConnectionManager::get_http_auth_header(&tool).unwrap_err();
        assert!(err.to_string().contains("re-authorize"), "got: {err}");
    }

    #[test]
    fn get_http_auth_header_errors_when_oauth_json_lacks_access_token() {
        install_test_keys();
        let encrypted = crate::crypto::encrypt(r#"{"refresh_token":"rt"}"#).unwrap();
        let tool = make_tool(
            "t1",
            "Oauth Bad",
            None,
            Some(r#"{"transport":"http","auth_type":"oauth"}"#),
            Some(encrypted),
        );
        let err = McpConnectionManager::get_http_auth_header(&tool).unwrap_err();
        assert!(
            err.to_string().contains("Missing access_token"),
            "got: {err}"
        );
    }

    #[test]
    fn get_http_auth_header_errors_on_undecryptable_bearer_token() {
        install_test_keys();
        let tool = make_tool(
            "t1",
            "Bearer Bad",
            None,
            Some(r#"{"transport":"http","auth_type":"bearer"}"#),
            Some("definitely-not-valid-ciphertext".to_string()),
        );
        let err = McpConnectionManager::get_http_auth_header(&tool).unwrap_err();
        assert!(err.to_string().contains("decrypt"), "got: {err}");
    }

    // ---- connection map operations ----

    #[tokio::test]
    async fn map_operations_on_empty_manager_are_noops() {
        let manager = McpConnectionManager::new();
        assert!(manager.get_active_connections().await.is_empty());
        manager.disconnect("any-id").await;
        manager.disconnect_all().await;
        assert!(manager.get_active_connections().await.is_empty());
    }

    #[tokio::test]
    async fn connect_multiple_with_no_tools_returns_empty_result() {
        let manager = McpConnectionManager::new();
        let result = manager.connect_multiple(&[]).await.unwrap();
        assert!(result.connections.is_empty());
        assert!(result.failures.is_empty());
    }

    #[tokio::test]
    async fn connect_multiple_collects_failures_without_connections() {
        let manager = McpConnectionManager::new();
        let tools = vec![
            // Port 1 is never listening: connection refused is immediate on loopback.
            make_tool(
                "t-refused",
                "Refused",
                Some("http://127.0.0.1:1/mcp"),
                Some(r#"{"transport":"http"}"#),
                None,
            ),
            make_tool(
                "t-no-endpoint",
                "No Endpoint",
                None,
                Some(r#"{"transport":"http"}"#),
                None,
            ),
            make_tool(
                "t-no-command",
                "No Command",
                None,
                Some(r#"{"transport":"stdio"}"#),
                None,
            ),
        ];

        let result = manager.connect_multiple(&tools).await.unwrap();
        assert!(result.connections.is_empty());
        assert_eq!(result.failures.len(), 3);

        let ids: Vec<&str> = result.failures.iter().map(|f| f.tool_id.as_str()).collect();
        assert_eq!(ids, vec!["t-refused", "t-no-endpoint", "t-no-command"]);

        assert!(
            !result.failures[0].error.is_empty(),
            "connection-refused failure should carry an error message"
        );
        assert!(
            result.failures[1]
                .error
                .contains("HTTP transport requires an endpoint URL"),
            "got: {}",
            result.failures[1].error
        );
        assert!(
            result.failures[2]
                .error
                .contains("STDIO transport requires a command"),
            "got: {}",
            result.failures[2].error
        );
    }
}
