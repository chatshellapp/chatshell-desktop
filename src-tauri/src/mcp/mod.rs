//! MCP (Model Context Protocol) integration module
//!
//! This module provides functionality to connect to MCP servers and retrieve
//! tool definitions that can be used with LLM agents.

mod manager;
pub(crate) mod oauth;

pub use manager::{McpConnectionManager, McpServerConnection};
pub use oauth::{
    discover, exchange_code, run_callback_server,
    OAuthAuthState, OAuthDiscoveryResult, OAuthTokens,
};
