//! MCP (Model Context Protocol) integration module
//!
//! This module provides functionality to connect to MCP servers and retrieve
//! tool definitions that can be used with LLM agents.

mod manager;
pub(crate) mod oauth;

pub use manager::{McpConnectionManager, McpServerConnection};
pub use oauth::{
    delete_tokens, discover, exchange_code, load_access_token, load_refresh_token, run_callback_server,
    store_tokens, OAuthAuthState, OAuthDiscoveryResult, OAuthTokens,
};
