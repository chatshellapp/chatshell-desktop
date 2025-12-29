//! MCP server management commands

use super::AppState;
use crate::models::{CreateToolRequest, Tool};
use serde::{Deserialize, Serialize};
use tauri::State;

/// MCP tool info returned from server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
}

/// Create a new MCP server configuration
#[tauri::command]
pub async fn create_mcp_server(
    state: State<'_, AppState>,
    name: String,
    endpoint: String,
    description: Option<String>,
    config: Option<String>,
) -> Result<Tool, String> {
    tracing::info!("🔌 Creating MCP server: {} at {}", name, endpoint);

    let req = CreateToolRequest {
        name,
        r#type: "mcp".to_string(),
        endpoint: Some(endpoint),
        config,
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
    endpoint: String,
    description: Option<String>,
    config: Option<String>,
    is_enabled: Option<bool>,
) -> Result<Tool, String> {
    tracing::info!("📝 Updating MCP server: {} at {}", name, endpoint);

    // Disconnect existing connection if endpoint changed
    state.mcp_manager.disconnect(&id).await;

    let req = CreateToolRequest {
        name,
        r#type: "mcp".to_string(),
        endpoint: Some(endpoint),
        config,
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

/// Test connection to an MCP server endpoint
#[tauri::command]
pub async fn test_mcp_connection(
    state: State<'_, AppState>,
    endpoint: String,
) -> Result<Vec<McpToolInfo>, String> {
    tracing::info!("🧪 Testing MCP connection to: {}", endpoint);

    let tools = state
        .mcp_manager
        .test_connection(&endpoint)
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

