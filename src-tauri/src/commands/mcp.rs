//! MCP server management commands

use super::AppState;
use crate::models::{CreateToolRequest, McpConfig, McpTransportType, Tool};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

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

/// List all MCP servers
#[tauri::command]
pub async fn list_mcp_servers(state: State<'_, AppState>) -> Result<Vec<Tool>, String> {
    state
        .db
        .list_tools_by_type("mcp")
        .await
        .map_err(|e| e.to_string())
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
