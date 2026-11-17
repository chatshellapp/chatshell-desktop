//! MCP (Model Context Protocol) integration module
//!
//! This module provides functionality to connect to MCP servers and retrieve
//! tool definitions that can be used with LLM agents.

pub(crate) mod auth_error;
#[cfg(test)]
mod live_tests;
mod manager;
pub(crate) mod oauth;
mod shell_path;

pub use manager::{
    McpConnectionManager, McpServerConnection, McpTokenStore, TokenUpdate, sync_tool_definitions,
};
pub use oauth::{
    OAuthAuthState, OAuthDiscoveryResult, OAuthTokens, discover, exchange_code, run_callback_server,
};
pub use shell_path::resolve_shell_path;
