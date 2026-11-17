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

use super::auth_error;
use super::oauth::{self, RefreshError};
use crate::models::{McpAuthType, McpConfig, McpTransportType, OAuthMetadata, Tool};

/// Refresh this long before the stored expiry, to absorb clock skew and the
/// time a send takes to reach the server.
const REFRESH_SKEW_SECS: i64 = 60;

/// How a refreshed or cleared grant reaches storage.
pub enum TokenUpdate {
    /// Leave `auth_token` as it is (metadata-only change).
    Keep,
    /// Replace `auth_token` with this encrypted token JSON.
    Set(String),
    /// Remove the stored token (definitive refresh rejection).
    Clear,
}

/// Persistence seam for OAuth grants, owned by the command layer so the
/// manager has no database dependency.
#[async_trait::async_trait]
pub trait McpTokenStore: Send + Sync {
    /// The server's current row, read from storage (never a cached copy).
    async fn load(&self, server_id: &str) -> Result<Tool>;
    /// Write the token and the OAuth metadata, returning the updated row.
    async fn save_grant(
        &self,
        server_id: &str,
        token: TokenUpdate,
        metadata: OAuthMetadata,
    ) -> Result<Tool>;
}

/// The decrypted OAuth token JSON stored in `tools.auth_token`.
struct StoredGrant {
    access_token: String,
    refresh_token: Option<String>,
}

/// A refresh attempt that produced no usable token.
enum RefreshFailure {
    /// The user has to sign in again (rejected grant, no refresh token, no
    /// way to find the token endpoint).
    NeedsAuth(String),
    /// Temporary failure; the stored grant is untouched.
    Transient(String),
}

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
    pub tool_name: String,
    pub error: String,
    /// The server rejected our credentials and the user must sign in again
    /// (after any silent refresh already failed).
    pub needs_auth: bool,
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
    /// Where refreshed OAuth grants are persisted. Unset in tests and
    /// before app setup; without it no refresh is attempted.
    token_store: std::sync::RwLock<Option<Arc<dyn McpTokenStore>>>,
    /// One lock per server, held across re-read → token POST → persist so
    /// two sends never redeem the same (possibly single-use) refresh token.
    refresh_locks: std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// HTTP client for token-endpoint calls.
    http: reqwest::Client,
}

impl McpConnectionManager {
    /// Create a new MCP connection manager
    pub fn new() -> Self {
        Self::default()
    }

    /// Install the persistence seam used for OAuth refresh.
    pub fn set_token_store(&self, store: Arc<dyn McpTokenStore>) {
        *self.token_store.write().unwrap_or_else(|e| e.into_inner()) = Some(store);
    }

    fn token_store(&self) -> Option<Arc<dyn McpTokenStore>> {
        self.token_store
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn refresh_lock(&self, server_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.refresh_locks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(server_id.to_string())
            .or_default()
            .clone()
    }

    /// The OAuth grant and metadata of an HTTP server using OAuth, if it has
    /// both.
    fn oauth_state(tool: &Tool) -> Option<(StoredGrant, OAuthMetadata)> {
        let config = tool.parse_mcp_config()?;
        if config.transport != McpTransportType::Http
            || config.auth_type != Some(McpAuthType::Oauth)
        {
            return None;
        }
        let metadata = config.oauth_metadata?;
        let encrypted = tool.auth_token.as_ref()?;
        let json = crate::crypto::decrypt(encrypted).ok()?;
        let parsed: serde_json::Value = serde_json::from_str(&json).ok()?;
        let access_token = parsed["access_token"].as_str()?.to_string();
        let refresh_token = parsed["refresh_token"]
            .as_str()
            .filter(|t| !t.is_empty())
            .map(str::to_string);
        Some((
            StoredGrant {
                access_token,
                refresh_token,
            },
            metadata,
        ))
    }

    /// The stored access token is past (or within the skew margin of) its
    /// recorded expiry. Grants without `token_expires_at` never qualify.
    fn expires_soon(metadata: &OAuthMetadata) -> bool {
        metadata
            .token_expires_at
            .is_some_and(|exp| exp - REFRESH_SKEW_SECS <= chrono::Utc::now().timestamp())
    }

    /// Redeem the stored refresh token and persist the new grant before it
    /// is used. `rejected_access_token` is set for a reactive refresh (the
    /// server answered 401 to that token); `None` means proactive.
    ///
    /// Returns the row to connect with: the refreshed one, or a newer one
    /// another task (or a sync) stored while we waited for the lock.
    async fn refresh_oauth(
        &self,
        tool: &Tool,
        rejected_access_token: Option<&str>,
    ) -> std::result::Result<Tool, RefreshFailure> {
        let Some(store) = self.token_store() else {
            return Err(RefreshFailure::Transient("no token store installed".into()));
        };
        let lock = self.refresh_lock(&tool.id);
        let _guard = lock.lock().await;

        // Re-read inside the lock: another send may have refreshed already.
        let fresh = store
            .load(&tool.id)
            .await
            .map_err(|e| RefreshFailure::Transient(format!("{e:#}")))?;
        let Some((grant, mut metadata)) = Self::oauth_state(&fresh) else {
            return Err(RefreshFailure::NeedsAuth("no stored OAuth grant".into()));
        };
        let already_refreshed = match rejected_access_token {
            Some(rejected) => grant.access_token != rejected,
            None => !Self::expires_soon(&metadata),
        };
        if already_refreshed {
            tracing::info!("🔐 OAuth grant for '{}' was already refreshed", tool.name);
            return Ok(fresh);
        }
        let Some(refresh_token) = grant.refresh_token.clone() else {
            return Err(RefreshFailure::NeedsAuth("no refresh token stored".into()));
        };

        let token_endpoint = match metadata.token_endpoint.clone() {
            Some(endpoint) => endpoint,
            None => {
                // Grant stored before the token endpoint was persisted.
                let endpoint =
                    oauth::fetch_token_endpoint(&self.http, &metadata.authorization_server_url)
                        .await
                        .map_err(|e| {
                            RefreshFailure::NeedsAuth(format!("token endpoint unknown: {e:#}"))
                        })?;
                metadata.token_endpoint = Some(endpoint.clone());
                if let Err(e) = store
                    .save_grant(&tool.id, TokenUpdate::Keep, metadata.clone())
                    .await
                {
                    tracing::warn!(
                        "⚠️ Could not persist token endpoint for '{}': {e:#}",
                        tool.name
                    );
                }
                endpoint
            }
        };
        let client_id = metadata
            .client_id
            .clone()
            .unwrap_or_else(|| oauth::FALLBACK_CLIENT_ID.to_string());
        let resource = fresh
            .endpoint
            .as_deref()
            .and_then(|e| oauth::resource_uri_for(e).ok());

        tracing::info!("🔐 Refreshing OAuth token for MCP server '{}'", tool.name);
        match oauth::refresh_access_token(
            &self.http,
            &token_endpoint,
            &client_id,
            &refresh_token,
            resource.as_deref(),
        )
        .await
        {
            Ok(tokens) => {
                // Non-rotating servers omit refresh_token: keep the stored one.
                let token_json = serde_json::json!({
                    "access_token": tokens.access_token,
                    "refresh_token": tokens.refresh_token.or(Some(refresh_token)),
                });
                let encrypted = crate::crypto::encrypt(&token_json.to_string())
                    .map_err(|e| RefreshFailure::Transient(format!("{e:#}")))?;
                metadata.token_expires_at = tokens
                    .expires_in_secs
                    .map(|s| chrono::Utc::now().timestamp() + s as i64);
                metadata.is_authorized = true;
                let saved = store
                    .save_grant(&tool.id, TokenUpdate::Set(encrypted), metadata)
                    .await
                    .map_err(|e| RefreshFailure::Transient(format!("{e:#}")))?;
                tracing::info!("✅ Refreshed OAuth token for MCP server '{}'", tool.name);
                Ok(saved)
            }
            Err(RefreshError::Rejected { code, description }) => {
                // Only clear the grant if it is still the one we tried: a
                // newer grant may have arrived via sync during the POST.
                if let Ok(current) = store.load(&tool.id).await
                    && let Some((current_grant, _)) = Self::oauth_state(&current)
                    && current_grant.refresh_token.as_deref() != Some(refresh_token.as_str())
                {
                    tracing::info!(
                        "🔐 Refresh for '{}' rejected, but a newer grant is stored; using it",
                        tool.name
                    );
                    return Ok(current);
                }
                let mut cleared = metadata;
                cleared.is_authorized = false;
                cleared.token_expires_at = None;
                if let Err(e) = store
                    .save_grant(&tool.id, TokenUpdate::Clear, cleared)
                    .await
                {
                    tracing::warn!(
                        "⚠️ Could not clear rejected grant for '{}': {e:#}",
                        tool.name
                    );
                }
                Err(RefreshFailure::NeedsAuth(match description {
                    Some(d) => format!("refresh token rejected ({code}: {d})"),
                    None => format!("refresh token rejected ({code})"),
                }))
            }
            Err(RefreshError::Transient(e)) => Err(RefreshFailure::Transient(e)),
        }
    }

    fn needs_auth_error(tool: &Tool, detail: &str) -> anyhow::Error {
        // "authentication required" keeps this classified as an auth failure.
        anyhow::anyhow!(
            "MCP server '{}' needs sign-in, authentication required: {}",
            tool.name,
            detail
        )
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

    /// Connect to an MCP server and retrieve its tools. OAuth servers get
    /// at most one token refresh per attempt: proactively when the stored
    /// expiry has passed, otherwise reactively when the server rejects the
    /// stored token (covers grants without an expiry and early revocation).
    pub async fn connect(&self, tool: &Tool) -> Result<McpServerConnection> {
        let Some((grant, metadata)) = Self::oauth_state(tool) else {
            return self.connect_once(tool).await;
        };

        let mut tool = tool.clone();
        let mut refresh_attempted = false;
        if Self::expires_soon(&metadata) && grant.refresh_token.is_some() {
            refresh_attempted = true;
            match self.refresh_oauth(&tool, None).await {
                Ok(refreshed) => tool = refreshed,
                Err(RefreshFailure::NeedsAuth(detail)) => {
                    return Err(Self::needs_auth_error(&tool, &detail));
                }
                Err(RefreshFailure::Transient(detail)) => {
                    // Try the stored token anyway; a 401 below classifies.
                    tracing::warn!(
                        "⚠️ Proactive OAuth refresh for '{}' failed: {}",
                        tool.name,
                        detail
                    );
                }
            }
        }

        let error = match self.connect_once(&tool).await {
            Ok(connection) => return Ok(connection),
            Err(e) => e,
        };
        if refresh_attempted || !auth_error::is_auth_error(&error) {
            return Err(error);
        }
        let Some((current, _)) = Self::oauth_state(&tool) else {
            return Err(error);
        };
        if current.refresh_token.is_none() {
            return Err(error);
        }

        tracing::info!(
            "🔐 MCP server '{}' rejected the stored token; refreshing once",
            tool.name
        );
        match self.refresh_oauth(&tool, Some(&current.access_token)).await {
            Ok(refreshed) => self.connect_once(&refreshed).await,
            Err(RefreshFailure::NeedsAuth(detail)) => Err(Self::needs_auth_error(&tool, &detail)),
            Err(RefreshFailure::Transient(detail)) => {
                Err(error.context(format!("OAuth token refresh failed: {detail}")))
            }
        }
    }

    /// One connection attempt with the token currently on `tool`.
    async fn connect_once(&self, tool: &Tool) -> Result<McpServerConnection> {
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

    /// Connect to multiple MCP servers concurrently and collect all tools.
    /// Servers are independent (each has its own refresh lock), so the send
    /// waits for the slowest server rather than the sum of all of them.
    pub async fn connect_multiple(&self, tools: &[Tool]) -> Result<ConnectMultipleResult> {
        let results =
            futures::future::join_all(tools.iter().map(|tool| self.get_or_connect(tool))).await;

        let mut connections = Vec::new();
        let mut failures = Vec::new();
        for (tool, result) in tools.iter().zip(results) {
            match result {
                Ok(conn) => {
                    let mcp_tools = conn.mcp_tools.clone();
                    connections.push((conn, mcp_tools));
                }
                Err(e) => {
                    let error_str = format!("{e:#}");
                    tracing::warn!(
                        "⚠️ Failed to connect to MCP server {}: {}",
                        tool.name,
                        error_str
                    );
                    failures.push(ConnectFailure {
                        tool_id: tool.id.clone(),
                        tool_name: tool.name.clone(),
                        needs_auth: auth_error::is_auth_error(&e),
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

    fn install_test_keys() -> parking_lot::MutexGuard<'static, ()> {
        let guard = crate::crypto::keys_test_guard();
        crate::crypto::set_keys_for_tests([0x5a; 32], None);
        guard
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
        let _keys = install_test_keys();
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
        let _keys = install_test_keys();
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
        let _keys = install_test_keys();
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
        let _keys = install_test_keys();
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

    // ---- OAuth refresh ----

    /// In-memory `McpTokenStore` holding one row.
    struct MemStore {
        tool: std::sync::Mutex<Tool>,
    }

    #[async_trait::async_trait]
    impl McpTokenStore for MemStore {
        async fn load(&self, _server_id: &str) -> Result<Tool> {
            Ok(self.tool.lock().unwrap().clone())
        }

        async fn save_grant(
            &self,
            _server_id: &str,
            token: TokenUpdate,
            metadata: OAuthMetadata,
        ) -> Result<Tool> {
            let mut tool = self.tool.lock().unwrap();
            match token {
                TokenUpdate::Keep => {}
                TokenUpdate::Set(t) => tool.auth_token = Some(t),
                TokenUpdate::Clear => tool.auth_token = None,
            }
            let mut config = tool.parse_mcp_config().unwrap();
            config.oauth_metadata = Some(metadata);
            tool.config = Some(config.to_json().unwrap());
            Ok(tool.clone())
        }
    }

    /// Loopback stub: `/token` answers `token_response` (counting POSTs,
    /// after `token_delay`), `/mcp` always answers 401, the RFC 8414
    /// well-known path answers AS metadata pointing at `/token`.
    async fn spawn_oauth_stub(
        token_status: u16,
        token_response: &'static str,
        token_delay: std::time::Duration,
    ) -> (String, Arc<std::sync::atomic::AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let token_posts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = token_posts.clone();
        let base_for_task = base.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let counter = counter.clone();
                let base = base_for_task.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 16 * 1024];
                    let n = socket.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                    let (status, content_type, body) = if path.starts_with("/token") {
                        counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        tokio::time::sleep(token_delay).await;
                        (token_status, "application/json", token_response.to_string())
                    } else if path.starts_with("/.well-known/oauth-authorization-server") {
                        (
                            200,
                            "application/json",
                            format!(
                                r#"{{"issuer":"{base}","authorization_endpoint":"{base}/authorize","token_endpoint":"{base}/token"}}"#
                            ),
                        )
                    } else {
                        (401, "text/plain", "unauthorized".to_string())
                    };
                    let reason = match status {
                        200 => "OK",
                        400 => "Bad Request",
                        _ => "Unauthorized",
                    };
                    let response = format!(
                        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nWWW-Authenticate: Bearer\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        (base, token_posts)
    }

    fn oauth_tool(
        endpoint: &str,
        token_endpoint: Option<&str>,
        expires_at: Option<i64>,
        refresh_token: Option<&str>,
        authorization_server_url: &str,
    ) -> Tool {
        let mut config = McpConfig::http();
        config.auth_type = Some(McpAuthType::Oauth);
        config.oauth_metadata = Some(OAuthMetadata {
            authorization_server_url: authorization_server_url.to_string(),
            client_id: Some("client-abc".into()),
            scopes: None,
            token_expires_at: expires_at,
            token_endpoint: token_endpoint.map(str::to_string),
            is_authorized: true,
        });
        let token = json!({ "access_token": "at-old", "refresh_token": refresh_token });
        make_tool(
            "srv",
            "Server",
            Some(endpoint),
            Some(&config.to_json().unwrap()),
            Some(crate::crypto::encrypt(&token.to_string()).unwrap()),
        )
    }

    fn manager_with(tool: &Tool) -> (McpConnectionManager, Arc<MemStore>) {
        let manager = McpConnectionManager::new();
        let store = Arc::new(MemStore {
            tool: std::sync::Mutex::new(tool.clone()),
        });
        manager.set_token_store(store.clone());
        (manager, store)
    }

    fn stored_grant(store: &MemStore) -> (Option<StoredGrant>, OAuthMetadata) {
        let tool = store.tool.lock().unwrap().clone();
        let metadata = tool.parse_mcp_config().unwrap().oauth_metadata.unwrap();
        (
            McpConnectionManager::oauth_state(&tool).map(|(g, _)| g),
            metadata,
        )
    }

    fn past() -> Option<i64> {
        Some(chrono::Utc::now().timestamp() - 10)
    }

    const ROTATED: &str = r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#;

    #[tokio::test]
    async fn expired_grant_is_refreshed_and_persisted_before_connecting() {
        let _keys = install_test_keys();
        let (base, posts) = spawn_oauth_stub(200, ROTATED, Default::default()).await;
        // MCP endpoint refuses connections: the failure must not be auth.
        let tool = oauth_tool(
            "http://127.0.0.1:1/mcp",
            Some(&format!("{base}/token")),
            past(),
            Some("rt-old"),
            &base,
        );
        let (manager, store) = manager_with(&tool);

        let err = manager
            .connect(&tool)
            .await
            .err()
            .expect("connect must fail");
        assert!(!auth_error::is_auth_error(&err), "got: {err:#}");

        assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 1);
        let (grant, metadata) = stored_grant(&store);
        let grant = grant.unwrap();
        assert_eq!(grant.access_token, "at-new");
        assert_eq!(grant.refresh_token.as_deref(), Some("rt-new"));
        assert!(metadata.token_expires_at.unwrap() > chrono::Utc::now().timestamp());
        assert!(metadata.is_authorized);
    }

    #[tokio::test]
    async fn non_rotating_refresh_keeps_the_stored_refresh_token() {
        let _keys = install_test_keys();
        let (base, _posts) =
            spawn_oauth_stub(200, r#"{"access_token":"at-new"}"#, Default::default()).await;
        let tool = oauth_tool(
            "http://127.0.0.1:1/mcp",
            Some(&format!("{base}/token")),
            past(),
            Some("rt-old"),
            &base,
        );
        let (manager, store) = manager_with(&tool);

        let _ = manager.connect(&tool).await;

        let (grant, metadata) = stored_grant(&store);
        let grant = grant.unwrap();
        assert_eq!(grant.access_token, "at-new");
        assert_eq!(grant.refresh_token.as_deref(), Some("rt-old"));
        assert_eq!(metadata.token_expires_at, None);
    }

    #[tokio::test]
    async fn rejected_token_without_expiry_triggers_one_reactive_refresh() {
        let _keys = install_test_keys();
        let (base, posts) = spawn_oauth_stub(200, ROTATED, Default::default()).await;
        // `/mcp` always answers 401, before and after the refresh.
        let tool = oauth_tool(
            &format!("{base}/mcp"),
            Some(&format!("{base}/token")),
            None,
            Some("rt-old"),
            &base,
        );
        let (manager, store) = manager_with(&tool);

        let err = manager
            .connect(&tool)
            .await
            .err()
            .expect("connect must fail");
        assert!(auth_error::is_auth_error(&err), "got: {err:#}");

        assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(stored_grant(&store).0.unwrap().access_token, "at-new");
    }

    #[tokio::test]
    async fn proactive_refresh_is_not_followed_by_a_reactive_one() {
        let _keys = install_test_keys();
        let (base, posts) = spawn_oauth_stub(200, ROTATED, Default::default()).await;
        let tool = oauth_tool(
            &format!("{base}/mcp"),
            Some(&format!("{base}/token")),
            past(),
            Some("rt-old"),
            &base,
        );
        let (manager, _store) = manager_with(&tool);

        let err = manager
            .connect(&tool)
            .await
            .err()
            .expect("connect must fail");
        assert!(auth_error::is_auth_error(&err), "got: {err:#}");
        assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn rejected_token_without_refresh_token_does_not_refresh() {
        let _keys = install_test_keys();
        let (base, posts) = spawn_oauth_stub(200, ROTATED, Default::default()).await;
        let tool = oauth_tool(
            &format!("{base}/mcp"),
            Some(&format!("{base}/token")),
            None,
            None,
            &base,
        );
        let (manager, _store) = manager_with(&tool);

        let err = manager
            .connect(&tool)
            .await
            .err()
            .expect("connect must fail");
        assert!(auth_error::is_auth_error(&err), "got: {err:#}");
        assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn invalid_grant_clears_the_grant_and_reports_needs_auth() {
        let _keys = install_test_keys();
        let (base, posts) =
            spawn_oauth_stub(400, r#"{"error":"invalid_grant"}"#, Default::default()).await;
        let tool = oauth_tool(
            "http://127.0.0.1:1/mcp",
            Some(&format!("{base}/token")),
            past(),
            Some("rt-old"),
            &base,
        );
        let (manager, store) = manager_with(&tool);

        let err = manager
            .connect(&tool)
            .await
            .err()
            .expect("connect must fail");
        assert!(auth_error::is_auth_error(&err), "got: {err:#}");
        assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 1);

        let (grant, metadata) = stored_grant(&store);
        assert!(grant.is_none(), "grant must be cleared");
        assert!(!metadata.is_authorized);
        assert_eq!(metadata.token_expires_at, None);
    }

    #[tokio::test]
    async fn transient_refresh_failure_leaves_the_grant_untouched() {
        let _keys = install_test_keys();
        let (base, _posts) = spawn_oauth_stub(
            400,
            r#"{"error":"temporarily_unavailable"}"#,
            Default::default(),
        )
        .await;
        let tool = oauth_tool(
            "http://127.0.0.1:1/mcp",
            Some(&format!("{base}/token")),
            past(),
            Some("rt-old"),
            &base,
        );
        let (manager, store) = manager_with(&tool);

        let err = manager
            .connect(&tool)
            .await
            .err()
            .expect("connect must fail");
        assert!(!auth_error::is_auth_error(&err), "got: {err:#}");

        let (grant, metadata) = stored_grant(&store);
        assert_eq!(grant.unwrap().access_token, "at-old");
        assert!(metadata.is_authorized);
    }

    #[tokio::test]
    async fn concurrent_refreshes_post_the_refresh_token_once() {
        let _keys = install_test_keys();
        let (base, posts) =
            spawn_oauth_stub(200, ROTATED, std::time::Duration::from_millis(200)).await;
        let tool = oauth_tool(
            "http://127.0.0.1:1/mcp",
            Some(&format!("{base}/token")),
            past(),
            Some("rt-old"),
            &base,
        );
        let (manager, _store) = manager_with(&tool);

        let (a, b) = tokio::join!(
            manager.refresh_oauth(&tool, None),
            manager.refresh_oauth(&tool, None)
        );

        assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 1);
        for result in [a, b] {
            let refreshed = result.ok().expect("both callers get a usable row");
            let (grant, _) = McpConnectionManager::oauth_state(&refreshed).unwrap();
            assert_eq!(grant.access_token, "at-new");
        }
    }

    #[tokio::test]
    async fn legacy_grant_learns_and_persists_the_token_endpoint() {
        let _keys = install_test_keys();
        let (base, posts) = spawn_oauth_stub(200, ROTATED, Default::default()).await;
        let tool = oauth_tool(
            "http://127.0.0.1:1/mcp",
            None,
            past(),
            Some("rt-old"),
            &base,
        );
        let (manager, store) = manager_with(&tool);

        let _ = manager.connect(&tool).await;

        assert_eq!(posts.load(std::sync::atomic::Ordering::SeqCst), 1);
        let (grant, metadata) = stored_grant(&store);
        assert_eq!(grant.unwrap().access_token, "at-new");
        assert_eq!(metadata.token_endpoint, Some(format!("{base}/token")));
    }

    #[test]
    fn expires_soon_respects_skew_and_missing_expiry() {
        let now = chrono::Utc::now().timestamp();
        let meta = |exp: Option<i64>| OAuthMetadata {
            authorization_server_url: String::new(),
            client_id: None,
            scopes: None,
            token_expires_at: exp,
            token_endpoint: None,
            is_authorized: true,
        };
        assert!(McpConnectionManager::expires_soon(&meta(Some(now - 1))));
        assert!(McpConnectionManager::expires_soon(&meta(Some(now + 30))));
        assert!(!McpConnectionManager::expires_soon(&meta(Some(now + 600))));
        assert!(!McpConnectionManager::expires_soon(&meta(None)));
    }
}
