use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub endpoint: Option<String>,
    pub config: Option<String>,
    pub description: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl Tool {
    /// Parse the config field as McpConfig
    pub fn parse_mcp_config(&self) -> Option<McpConfig> {
        self.config
            .as_ref()
            .and_then(|c| serde_json::from_str(c).ok())
    }

    /// Get the transport type for this MCP server
    pub fn get_transport_type(&self) -> McpTransportType {
        self.parse_mcp_config()
            .map(|c| c.transport)
            .unwrap_or(McpTransportType::Http)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateToolRequest {
    pub name: String,
    pub r#type: String,
    pub endpoint: Option<String>,
    pub config: Option<String>,
    pub description: Option<String>,
    pub is_enabled: Option<bool>,
}

/// MCP transport type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum McpTransportType {
    #[default]
    Http,
    Stdio,
}

/// MCP server configuration stored in the `config` field as JSON
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
    /// Transport type: "http" or "stdio"
    pub transport: McpTransportType,

    /// STDIO-specific configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,

    /// Command arguments (for STDIO)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,

    /// Environment variables (for STDIO)
    /// These will be merged with the current process environment
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,

    /// Working directory (for STDIO)
    /// Defaults to user's home directory if not specified
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

impl McpConfig {
    /// Create a new HTTP transport config
    pub fn http() -> Self {
        Self {
            transport: McpTransportType::Http,
            command: None,
            args: None,
            env: None,
            cwd: None,
        }
    }

    /// Create a new STDIO transport config
    pub fn stdio(command: String) -> Self {
        Self {
            transport: McpTransportType::Stdio,
            command: Some(command),
            args: None,
            env: None,
            cwd: None,
        }
    }

    /// Set arguments for STDIO transport
    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.args = Some(args);
        self
    }

    /// Set environment variables for STDIO transport
    pub fn with_env(mut self, env: HashMap<String, String>) -> Self {
        self.env = Some(env);
        self
    }

    /// Set working directory for STDIO transport
    pub fn with_cwd(mut self, cwd: String) -> Self {
        self.cwd = Some(cwd);
        self
    }

    /// Serialize to JSON string
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}
