//! MCP (Model Context Protocol) integration module
//!
//! This module provides functionality to connect to MCP servers and retrieve
//! tool definitions that can be used with LLM agents.

mod manager;
pub(crate) mod oauth;

pub use manager::{McpConnectionManager, McpServerConnection, sync_tool_definitions};
pub use oauth::{
    OAuthAuthState, OAuthDiscoveryResult, OAuthTokens, discover, exchange_code, run_callback_server,
};
