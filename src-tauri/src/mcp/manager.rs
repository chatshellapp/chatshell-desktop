//! MCP Connection Manager
//!
//! Manages connections to MCP servers via Streamable HTTP and STDIO transports.

use anyhow::{Context, Result};
use rmcp::model::{ClientCapabilities, ClientInfo, Implementation, Tool as McpTool};
use rmcp::service::{Peer, RunningService};
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use rmcp::transport::TokioChildProcess;
use rmcp::{RoleClient, ServiceExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::models::{McpConfig, McpTransportType, Tool};

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

    /// Connect to an MCP server via HTTP transport
    async fn connect_http(&self, endpoint: &str) -> Result<McpRunningService> {
        tracing::info!("🌐 Connecting via HTTP to: {}", endpoint);

        let http_client = reqwest::Client::new();
        let config = StreamableHttpClientTransportConfig {
            uri: endpoint.to_string().into(),
            ..Default::default()
        };
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
        let parsed_parts: Vec<String> = shell_words::split(command_str)
            .unwrap_or_else(|_| vec![command_str.to_string()]);

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
        let essential_vars = ["PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TERM"];
        for var in essential_vars {
            if let Ok(value) = std::env::var(var) {
                cmd.env(var, value);
            }
        }
        if let Some(env_vars) = &config.env {
            cmd.envs(env_vars);
            tracing::debug!("  Custom env vars: {:?}", env_vars.keys().collect::<Vec<_>>());
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
                self.connect_http(endpoint).await?
            }
            McpTransportType::Stdio => {
                let mcp_config = config
                    .ok_or_else(|| anyhow::anyhow!("STDIO transport requires a config"))?;
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

    /// Get a cached connection or create a new one
    pub async fn get_or_connect(&self, tool: &Tool) -> Result<McpServerConnection> {
        // Check cache first
        {
            let connections = self.connections.read().await;
            if let Some(conn) = connections.get(&tool.id) {
                return Ok(conn.clone());
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
    pub async fn connect_multiple(
        &self,
        tools: &[Tool],
    ) -> Result<Vec<(McpServerConnection, Vec<McpTool>)>> {
        let mut results = Vec::new();

        for tool in tools {
            match self.get_or_connect(tool).await {
                Ok(conn) => {
                    let mcp_tools = conn.mcp_tools.clone();
                    results.push((conn, mcp_tools));
                }
                Err(e) => {
                    tracing::warn!("⚠️ Failed to connect to MCP server {}: {}", tool.name, e);
                    // Continue with other servers
                }
            }
        }

        Ok(results)
    }

    /// Test connection to an MCP server via HTTP
    pub async fn test_http_connection(&self, endpoint: &str) -> Result<Vec<McpTool>> {
        tracing::info!("🧪 Testing HTTP connection to: {}", endpoint);

        let running_service = self.connect_http(endpoint).await?;

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
        // For backward compatibility, this method assumes HTTP transport
        self.test_http_connection(endpoint).await
    }
}
