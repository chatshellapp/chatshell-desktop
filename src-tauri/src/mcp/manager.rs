//! MCP Connection Manager
//!
//! Manages connections to MCP servers via Streamable HTTP and STDIO transports.

use anyhow::{Context, Result};
use rmcp::model::{ClientCapabilities, ClientInfo, Implementation, Tool as McpTool};
use rmcp::service::{Peer, RunningService};
use rmcp::transport::TokioChildProcess;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use rmcp::{RoleClient, ServiceExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

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
        ClientInfo {
            protocol_version: Default::default(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: "chatshell".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                ..Default::default()
            },
        }
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

    /// Connect to an MCP server via HTTP transport
    async fn connect_http(
        &self,
        endpoint: &str,
        auth_header: Option<String>,
        custom_headers: Option<&HashMap<String, String>>,
    ) -> Result<McpRunningService> {
        tracing::info!("🌐 Connecting via HTTP to: {}", endpoint);

        let http_client = if let Some(headers) = custom_headers {
            let mut header_map = reqwest::header::HeaderMap::new();
            for (k, v) in headers {
                if let (Ok(name), Ok(val)) = (
                    reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                    reqwest::header::HeaderValue::from_str(v),
                ) {
                    header_map.insert(name, val);
                }
            }
            reqwest::Client::builder()
                .default_headers(header_map)
                .build()
                .context("Failed to build HTTP client with custom headers")?
        } else {
            reqwest::Client::new()
        };

        let mut config = StreamableHttpClientTransportConfig {
            uri: endpoint.to_string().into(),
            ..Default::default()
        };
        if let Some(token) = auth_header {
            config = config.auth_header(token);
        }
        let transport = StreamableHttpClientTransport::with_client(http_client, config);

        let client_info = Self::create_client_info();
        let running_service = client_info
            .serve(transport)
            .await
            .context("Failed to connect to MCP server via HTTP")?;

        Ok(running_service)
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
            cmd.envs(env_vars);
            tracing::debug!(
                "  Custom env vars: {:?}",
                env_vars.keys().collect::<Vec<_>>()
            );
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
