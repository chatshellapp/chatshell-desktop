//! MCP (Model Context Protocol) integration module
//!
//! This module provides functionality to connect to MCP servers and retrieve
//! tool definitions that can be used with LLM agents.

pub(crate) mod auth_error;
pub mod elicitation;
#[cfg(test)]
mod live_feature_tests;
#[cfg(test)]
mod live_tests;
mod manager;
pub(crate) mod oauth;
mod shell_path;

pub use manager::{
    McpConnectionManager, McpServerConnection, McpTokenStore, McpToolsChanged, McpToolsChangedHook,
    TokenUpdate, sync_tool_definitions,
};
pub use oauth::{
    OAuthAuthState, OAuthDiscoveryResult, OAuthTokens, discover, exchange_code, run_callback_server,
};
pub use shell_path::resolve_shell_path;

/// Where per-server tool definition JSON files live (read by `mcp_schema`).
pub fn tool_definitions_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> std::path::PathBuf {
    use tauri::Manager;
    app.path()
        .app_cache_dir()
        .map(|d| d.join("mcp-tools"))
        .unwrap_or_else(|_| std::env::temp_dir().join("chatshell-mcp-tools"))
}

/// The app-level reaction to a server-reported tool list change: rewrite
/// that server's definition files (so `mcp_schema` sees new tools without a
/// reconnect) and emit `mcp-tools-changed` for the settings UI. The model's
/// catalog picks the change up on the next turn.
pub fn tools_changed_hook<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> McpToolsChangedHook {
    use tauri::Emitter;
    std::sync::Arc::new(move |change: McpToolsChanged| {
        let dir = tool_definitions_dir(&app);
        if let Err(e) = sync_tool_definitions(&dir, &change.server_name, &change.tools) {
            tracing::warn!(
                "⚠️ Could not rewrite tool definitions for '{}': {e:#}",
                change.server_name
            );
        }
        let _ = app.emit(
            "mcp-tools-changed",
            serde_json::json!({
                "server_id": change.server_id,
                "server_name": change.server_name,
                "tool_count": change.tools.len(),
            }),
        );
    })
}
