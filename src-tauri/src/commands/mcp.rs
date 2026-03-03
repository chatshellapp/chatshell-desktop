//! MCP server management commands

use super::AppState;
use crate::mcp::oauth;
use crate::models::{
    CreateToolRequest, McpAuthType, McpConfig, McpTransportType, OAuthMetadata, Tool,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tauri::State;
use tokio::sync::oneshot;
use tokio::time::timeout;

/// Default OAuth client ID for ChatShell (public client, no secret)
const MCP_OAUTH_CLIENT_ID: &str = "chatshell-desktop";

/// State for a pending OAuth flow (stored in AppState.pending_oauth)
pub struct PendingOAuthState {
    pub rx: oneshot::Receiver<(String, String)>,
    pub auth_state: oauth::OAuthAuthState,
    pub discovery: oauth::OAuthDiscoveryResult,
    pub client_id: String,
    pub client_secret: Option<String>,
}

/// MCP tool info returned from server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
}

/// MCP server configuration for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub transport: String, // "http" or "stdio"
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub cwd: Option<String>,
    pub auth_type: Option<String>, // "none", "bearer", "oauth"
    pub oauth_metadata: Option<OAuthMetadataDto>,
}

/// OAuth metadata DTO for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthMetadataDto {
    pub authorization_server_url: String,
    pub client_id: Option<String>,
    pub scopes: Option<Vec<String>>,
    pub token_expires_at: Option<i64>,
    pub is_authorized: bool,
}

impl From<McpConfig> for McpServerConfig {
    fn from(config: McpConfig) -> Self {
        Self {
            transport: match config.transport {
                McpTransportType::Http => "http".to_string(),
                McpTransportType::Stdio => "stdio".to_string(),
            },
            command: config.command,
            args: config.args,
            env: config.env,
            cwd: config.cwd,
            auth_type: config.auth_type.map(|a| match a {
                crate::models::McpAuthType::None => "none".to_string(),
                crate::models::McpAuthType::Bearer => "bearer".to_string(),
                crate::models::McpAuthType::Oauth => "oauth".to_string(),
            }),
            oauth_metadata: config.oauth_metadata.map(|m| OAuthMetadataDto {
                authorization_server_url: m.authorization_server_url,
                client_id: m.client_id,
                scopes: m.scopes,
                token_expires_at: m.token_expires_at,
                is_authorized: m.is_authorized,
            }),
        }
    }
}

impl From<McpServerConfig> for McpConfig {
    fn from(config: McpServerConfig) -> Self {
        Self {
            transport: match config.transport.as_str() {
                "stdio" => McpTransportType::Stdio,
                _ => McpTransportType::Http,
            },
            command: config.command,
            args: config.args,
            env: config.env,
            cwd: config.cwd,
            auth_type: config.auth_type.as_deref().map(|s| match s {
                "bearer" => crate::models::McpAuthType::Bearer,
                "oauth" => crate::models::McpAuthType::Oauth,
                _ => crate::models::McpAuthType::None,
            }),
            oauth_metadata: config.oauth_metadata.map(|m| crate::models::OAuthMetadata {
                authorization_server_url: m.authorization_server_url,
                client_id: m.client_id,
                scopes: m.scopes,
                token_expires_at: m.token_expires_at,
                is_authorized: m.is_authorized,
            }),
        }
    }
}

/// Create a new MCP server configuration
#[tauri::command]
pub async fn create_mcp_server(
    state: State<'_, AppState>,
    name: String,
    endpoint: Option<String>,
    description: Option<String>,
    config: Option<McpServerConfig>,
) -> Result<Tool, String> {
    // Determine transport type and validate
    let (final_endpoint, final_config) = if let Some(cfg) = config {
        let transport = cfg.transport.as_str();
        match transport {
            "stdio" => {
                if cfg.command.is_none() {
                    return Err("STDIO transport requires a command".to_string());
                }
                let mcp_config: McpConfig = cfg.into();
                tracing::info!(
                    "🔌 Creating STDIO MCP server: {} (command: {:?})",
                    name,
                    mcp_config.command
                );
                (None, Some(mcp_config.to_json().map_err(|e| e.to_string())?))
            }
            "http" | _ => {
                let ep = endpoint.ok_or("HTTP transport requires an endpoint URL")?;
                tracing::info!("🔌 Creating HTTP MCP server: {} at {}", name, ep);
                let mcp_config = McpConfig::http();
                (
                    Some(ep),
                    Some(mcp_config.to_json().map_err(|e| e.to_string())?),
                )
            }
        }
    } else {
        // Backward compatibility: no config means HTTP transport
        let ep = endpoint.ok_or("HTTP transport requires an endpoint URL")?;
        tracing::info!("🔌 Creating HTTP MCP server: {} at {}", name, ep);
        let mcp_config = McpConfig::http();
        (
            Some(ep),
            Some(mcp_config.to_json().map_err(|e| e.to_string())?),
        )
    };

    let req = CreateToolRequest {
        name,
        r#type: "mcp".to_string(),
        endpoint: final_endpoint,
        config: final_config,
        description,
        is_enabled: Some(true),
    };

    state.db.create_tool(req).await.map_err(|e| e.to_string())
}

/// List all MCP servers and builtin tools
/// Returns both MCP servers (type='mcp') and builtin tools (type='builtin')
/// for use in the tools selection dialog
#[tauri::command]
pub async fn list_mcp_servers(state: State<'_, AppState>) -> Result<Vec<Tool>, String> {
    // Return all tools (MCP + builtin) so the UI can display both
    state.db.list_tools().await.map_err(|e| e.to_string())
}

/// Get a specific MCP server
#[tauri::command]
pub async fn get_mcp_server(state: State<'_, AppState>, id: String) -> Result<Tool, String> {
    state.db.get_tool(&id).await.map_err(|e| e.to_string())
}

/// Update an MCP server configuration
#[tauri::command]
pub async fn update_mcp_server(
    state: State<'_, AppState>,
    id: String,
    name: String,
    endpoint: Option<String>,
    description: Option<String>,
    config: Option<McpServerConfig>,
    is_enabled: Option<bool>,
) -> Result<Tool, String> {
    // Disconnect existing connection
    state.mcp_manager.disconnect(&id).await;

    // Determine transport type and validate
    let (final_endpoint, final_config) = if let Some(cfg) = config {
        let transport = cfg.transport.as_str();
        match transport {
            "stdio" => {
                if cfg.command.is_none() {
                    return Err("STDIO transport requires a command".to_string());
                }
                let mcp_config: McpConfig = cfg.into();
                tracing::info!(
                    "📝 Updating STDIO MCP server: {} (command: {:?})",
                    name,
                    mcp_config.command
                );
                (None, Some(mcp_config.to_json().map_err(|e| e.to_string())?))
            }
            "http" | _ => {
                let ep = endpoint.ok_or("HTTP transport requires an endpoint URL")?;
                tracing::info!("📝 Updating HTTP MCP server: {} at {}", name, ep);
                let mcp_config = McpConfig::http();
                (
                    Some(ep),
                    Some(mcp_config.to_json().map_err(|e| e.to_string())?),
                )
            }
        }
    } else {
        // Backward compatibility: no config means HTTP transport
        let ep = endpoint.ok_or("HTTP transport requires an endpoint URL")?;
        tracing::info!("📝 Updating HTTP MCP server: {} at {}", name, ep);
        let mcp_config = McpConfig::http();
        (
            Some(ep),
            Some(mcp_config.to_json().map_err(|e| e.to_string())?),
        )
    };

    let req = CreateToolRequest {
        name,
        r#type: "mcp".to_string(),
        endpoint: final_endpoint,
        config: final_config,
        description,
        is_enabled,
    };

    state
        .db
        .update_tool(&id, req)
        .await
        .map_err(|e| e.to_string())
}

/// Delete an MCP server configuration
#[tauri::command]
pub async fn delete_mcp_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    tracing::info!("🗑️ Deleting MCP server: {}", id);

    // Disconnect if connected
    state.mcp_manager.disconnect(&id).await;

    state.db.delete_tool(&id).await.map_err(|e| e.to_string())
}

/// Toggle MCP server enabled status
#[tauri::command]
pub async fn toggle_mcp_server(state: State<'_, AppState>, id: String) -> Result<Tool, String> {
    state
        .db
        .toggle_tool_enabled(&id)
        .await
        .map_err(|e| e.to_string())
}

/// Set all tools of a given type to enabled or disabled
#[tauri::command]
pub async fn set_all_tools_enabled(
    state: State<'_, AppState>,
    tool_type: String,
    enabled: bool,
) -> Result<Vec<Tool>, String> {
    state
        .db
        .set_all_tools_enabled(&tool_type, enabled)
        .await
        .map_err(|e| e.to_string())
}

/// Test connection to an MCP server via HTTP endpoint
#[tauri::command]
pub async fn test_mcp_connection(
    state: State<'_, AppState>,
    endpoint: String,
) -> Result<Vec<McpToolInfo>, String> {
    tracing::info!("🧪 Testing HTTP MCP connection to: {}", endpoint);

    let tools = state
        .mcp_manager
        .test_http_connection(&endpoint)
        .await
        .map_err(|e| e.to_string())?;

    Ok(tools
        .into_iter()
        .map(|t| McpToolInfo {
            name: t.name.to_string(),
            description: t.description.map(|d| d.to_string()),
        })
        .collect())
}

/// Test connection to an MCP server via STDIO
#[tauri::command]
pub async fn test_mcp_stdio_connection(
    state: State<'_, AppState>,
    config: McpServerConfig,
) -> Result<Vec<McpToolInfo>, String> {
    tracing::info!("🧪 Testing STDIO MCP connection: {:?}", config.command);

    if config.command.is_none() {
        return Err("STDIO transport requires a command".to_string());
    }

    let mcp_config: McpConfig = config.into();

    let tools = state
        .mcp_manager
        .test_stdio_connection(&mcp_config)
        .await
        .map_err(|e| e.to_string())?;

    Ok(tools
        .into_iter()
        .map(|t| McpToolInfo {
            name: t.name.to_string(),
            description: t.description.map(|d| d.to_string()),
        })
        .collect())
}

/// List tools available from an MCP server
#[tauri::command]
pub async fn list_mcp_server_tools(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<McpToolInfo>, String> {
    let tool = state.db.get_tool(&id).await.map_err(|e| e.to_string())?;

    let connection = state
        .mcp_manager
        .get_or_connect(&tool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(connection
        .mcp_tools
        .into_iter()
        .map(|t| McpToolInfo {
            name: t.name.to_string(),
            description: t.description.map(|d| d.to_string()),
        })
        .collect())
}

/// Get MCP servers enabled for a conversation
#[tauri::command]
pub async fn get_conversation_mcp_servers(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<Tool>, String> {
    let settings = state
        .db
        .get_conversation_settings(&conversation_id)
        .await
        .map_err(|e| e.to_string())?;

    if settings.enabled_mcp_server_ids.is_empty() {
        return Ok(Vec::new());
    }

    state
        .db
        .get_tools_by_ids(&settings.enabled_mcp_server_ids)
        .await
        .map_err(|e| e.to_string())
}

// --- OAuth commands ---

#[derive(Debug, Serialize, Deserialize)]
pub struct StartOAuthResult {
    pub auth_url: String,
    pub redirect_uri: String,
}

/// Start OAuth flow for an HTTP MCP server: discover, build auth URL, start callback server
#[tauri::command]
pub async fn start_mcp_oauth(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<StartOAuthResult, String> {
    let tool = state.db.get_tool(&server_id).await.map_err(|e| e.to_string())?;
    let config = tool
        .parse_mcp_config()
        .ok_or("Invalid MCP config")?;
    if config.transport != McpTransportType::Http {
        return Err("OAuth is only supported for HTTP transport".to_string());
    }
    let endpoint = tool
        .endpoint
        .as_ref()
        .ok_or("HTTP MCP server has no endpoint")?;

    let http_client = reqwest::Client::new();
    let discovery = oauth::discover(&http_client, endpoint)
        .await
        .map_err(|e| e.to_string())?;

    let (port, rx) = oauth::run_callback_server()
        .await
        .map_err(|e| e.to_string())?;

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    let (client_id, client_secret) = if let Some(ref reg_url) = discovery.registration_endpoint {
        oauth::register_client(&http_client, reg_url, &redirect_uri)
            .await
            .map_err(|e| e.to_string())?
    } else {
        (MCP_OAUTH_CLIENT_ID.to_string(), None)
    };

    let auth_state = oauth::start_authorization(
        &discovery,
        &redirect_uri,
        &client_id,
        client_secret.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    let auth_url = auth_state.auth_url.clone();
    let pending = PendingOAuthState {
        rx,
        auth_state,
        discovery,
        client_id,
        client_secret,
    };
    {
        let mut map = state.pending_oauth.write().await;
        map.insert(server_id, pending);
    }

    Ok(StartOAuthResult {
        auth_url,
        redirect_uri,
    })
}

/// Complete OAuth flow after user authorized: wait for callback, exchange code, store tokens
#[tauri::command]
pub async fn complete_mcp_oauth(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Tool, String> {
    let pending = {
        let mut map = state.pending_oauth.write().await;
        map.remove(&server_id).ok_or("No pending OAuth for this server")?
    };

    let (code, state_param) = timeout(Duration::from_secs(300), pending.rx)
        .await
        .map_err(|_| "OAuth callback timeout")?
        .map_err(|_| "OAuth callback channel closed")?;

    let http_client = reqwest::Client::new();
    let tokens = oauth::exchange_code(
        &pending.discovery,
        &pending.auth_state.redirect_uri,
        &pending.client_id,
        pending.client_secret.as_deref(),
        &code,
        &state_param,
        pending.auth_state.pkce_verifier,
        &http_client,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Store OAuth tokens encrypted in SQLite (not the OS keychain)
    let oauth_json = serde_json::json!({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
    });
    let encrypted = crate::crypto::encrypt(&oauth_json.to_string()).map_err(|e| e.to_string())?;
    state
        .db
        .set_tool_auth_token(&server_id, Some(&encrypted))
        .await
        .map_err(|e| e.to_string())?;

    let expires_at = tokens
        .expires_in_secs
        .map(|s| chrono::Utc::now().timestamp() + s as i64);

    let mut tool = state.db.get_tool(&server_id).await.map_err(|e| e.to_string())?;
    let mut config: McpConfig = tool
        .parse_mcp_config()
        .unwrap_or_else(McpConfig::http);
    config.auth_type = Some(McpAuthType::Oauth);
    config.oauth_metadata = Some(OAuthMetadata {
        authorization_server_url: pending.discovery.authorization_server_url,
        client_id: Some(pending.client_id),
        scopes: Some(pending.discovery.scopes_supported),
        token_expires_at: expires_at,
        is_authorized: true,
    });
    tool.config = Some(config.to_json().map_err(|e| e.to_string())?);
    state
        .db
        .update_tool(
            &server_id,
            CreateToolRequest {
                name: tool.name.clone(),
                r#type: tool.r#type.clone(),
                endpoint: tool.endpoint.clone(),
                config: tool.config.clone(),
                description: tool.description.clone(),
                is_enabled: Some(tool.is_enabled),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    state.mcp_manager.disconnect(&server_id).await;

    state.db.get_tool(&server_id).await.map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthStatusResult {
    pub is_authorized: bool,
    pub token_expires_at: Option<i64>,
}

/// Check OAuth authorization status for an MCP server
#[tauri::command]
pub async fn check_mcp_oauth_status(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<OAuthStatusResult, String> {
    let tool = state.db.get_tool(&server_id).await.map_err(|e| e.to_string())?;
    let config = tool.parse_mcp_config().unwrap_or_else(McpConfig::http);
    let meta = match &config.oauth_metadata {
        Some(m) => m,
        None => {
            return Ok(OAuthStatusResult {
                is_authorized: false,
                token_expires_at: None,
            })
        }
    };
    let has_token = tool.auth_token.is_some();
    Ok(OAuthStatusResult {
        is_authorized: meta.is_authorized && has_token,
        token_expires_at: meta.token_expires_at,
    })
}

/// Revoke OAuth tokens for an MCP server
#[tauri::command]
pub async fn revoke_mcp_oauth(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<(), String> {
    state
        .db
        .set_tool_auth_token(&server_id, None)
        .await
        .map_err(|e| e.to_string())?;
    state.mcp_manager.disconnect(&server_id).await;

    let mut tool = state.db.get_tool(&server_id).await.map_err(|e| e.to_string())?;
    if let Some(mut config) = tool.parse_mcp_config() {
        if let Some(meta) = config.oauth_metadata.as_ref() {
            config.oauth_metadata = Some(OAuthMetadata {
                authorization_server_url: meta.authorization_server_url.clone(),
                client_id: meta.client_id.clone(),
                scopes: meta.scopes.clone(),
                token_expires_at: None,
                is_authorized: false,
            });
        }
        tool.config = Some(config.to_json().map_err(|e| e.to_string())?);
        state
            .db
            .update_tool(
                &server_id,
                CreateToolRequest {
                    name: tool.name.clone(),
                    r#type: tool.r#type.clone(),
                    endpoint: tool.endpoint.clone(),
                    config: tool.config.clone(),
                    description: tool.description.clone(),
                    is_enabled: Some(tool.is_enabled),
                },
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Store a manual Bearer token for an MCP server (HTTP transport).
/// The token is encrypted with AES-256-GCM and stored in SQLite (not the OS keychain).
#[tauri::command]
pub async fn set_mcp_bearer_token(
    state: State<'_, AppState>,
    server_id: String,
    token: String,
) -> Result<(), String> {
    let encrypted = crate::crypto::encrypt(&token).map_err(|e| e.to_string())?;
    state
        .db
        .set_tool_auth_token(&server_id, Some(&encrypted))
        .await
        .map_err(|e| e.to_string())?;
    state.mcp_manager.disconnect(&server_id).await;
    Ok(())
}
