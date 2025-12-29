//! MCP (Model Context Protocol) integration module
//!
//! This module provides functionality to connect to MCP servers and retrieve
//! tool definitions that can be used with LLM agents.

mod manager;

pub use manager::{McpConnectionManager, McpServerConnection};

