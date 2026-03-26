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
    /// Encrypted MCP auth token (Bearer or OAuth JSON), stored in SQLite.
    /// Encrypted with the same AES-256-GCM master key used for provider API keys,
    /// so reading this field never triggers the macOS keychain dialog.
    #[serde(skip_serializing)]
    pub auth_token: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Tool {
    /// Parse the config field as McpConfig
    pub fn parse_mcp_config(&self) -> Option<McpConfig> {
        self.config.as_ref().and_then(|c| match serde_json::from_str(c) {
            Ok(config) => Some(config),
            Err(e) => {
                tracing::error!(
                    "Failed to parse MCP config for tool '{}' (id={}): {}. Raw config: {}",
                    self.name,
                    self.id,
                    e,
                    c
                );
                None
            }
        })
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

/// MCP HTTP auth type (OAuth applies only to HTTP transport per MCP spec)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum McpAuthType {
    #[default]
    None,
    Bearer,
    Oauth,
}

/// OAuth metadata stored after discovery/authorization (in config JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthMetadata {
    pub authorization_server_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_expires_at: Option<i64>,
    pub is_authorized: bool,
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

    /// Auth type for HTTP transport: "none", "bearer", "oauth"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_type: Option<McpAuthType>,

    /// OAuth metadata (populated after discovery/authorization)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_metadata: Option<OAuthMetadata>,

    /// Custom HTTP headers (for HTTP transport)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
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
            auth_type: None,
            oauth_metadata: None,
            headers: None,
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
            auth_type: None,
            oauth_metadata: None,
            headers: None,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn create_mock_tool(config: Option<String>) -> Tool {
        Tool {
            id: "tool-1".to_string(),
            name: "Test Tool".to_string(),
            r#type: "mcp".to_string(),
            endpoint: Some("http://localhost:3000".to_string()),
            config,
            description: Some("A test tool".to_string()),
            is_enabled: true,
            auth_token: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_mcp_transport_type_default() {
        assert_eq!(McpTransportType::default(), McpTransportType::Http);
    }

    #[test]
    fn test_mcp_config_http() {
        let config = McpConfig::http();
        assert_eq!(config.transport, McpTransportType::Http);
        assert!(config.command.is_none());
        assert!(config.args.is_none());
        assert!(config.env.is_none());
        assert!(config.cwd.is_none());
    }

    #[test]
    fn test_mcp_config_stdio() {
        let config = McpConfig::stdio("npx".to_string());
        assert_eq!(config.transport, McpTransportType::Stdio);
        assert_eq!(config.command, Some("npx".to_string()));
    }

    #[test]
    fn test_mcp_config_with_args() {
        let config = McpConfig::stdio("npx".to_string())
            .with_args(vec!["-y".to_string(), "some-package".to_string()]);
        assert_eq!(
            config.args,
            Some(vec!["-y".to_string(), "some-package".to_string()])
        );
    }

    #[test]
    fn test_mcp_config_with_env() {
        let mut env = HashMap::new();
        env.insert("API_KEY".to_string(), "secret".to_string());
        let config = McpConfig::stdio("node".to_string()).with_env(env.clone());
        assert_eq!(config.env, Some(env));
    }

    #[test]
    fn test_mcp_config_with_cwd() {
        let config = McpConfig::stdio("node".to_string()).with_cwd("/path/to/dir".to_string());
        assert_eq!(config.cwd, Some("/path/to/dir".to_string()));
    }

    #[test]
    fn test_mcp_config_to_json() {
        let config = McpConfig::http();
        let json = config.to_json().unwrap();
        assert!(json.contains(r#""transport":"http""#));
    }

    #[test]
    fn test_mcp_config_serialization_roundtrip() {
        let config = McpConfig::stdio("npx".to_string())
            .with_args(vec!["-y".to_string(), "server".to_string()])
            .with_cwd("/home/user".to_string());

        let json = config.to_json().unwrap();
        let parsed: McpConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.transport, McpTransportType::Stdio);
        assert_eq!(parsed.command, Some("npx".to_string()));
        assert_eq!(
            parsed.args,
            Some(vec!["-y".to_string(), "server".to_string()])
        );
        assert_eq!(parsed.cwd, Some("/home/user".to_string()));
    }

    #[test]
    fn test_tool_parse_mcp_config_valid() {
        let config = McpConfig::stdio("npx".to_string());
        let tool = create_mock_tool(Some(config.to_json().unwrap()));

        let parsed = tool.parse_mcp_config();
        assert!(parsed.is_some());
        assert_eq!(parsed.unwrap().transport, McpTransportType::Stdio);
    }

    #[test]
    fn test_tool_parse_mcp_config_none() {
        let tool = create_mock_tool(None);
        assert!(tool.parse_mcp_config().is_none());
    }

    #[test]
    fn test_tool_parse_mcp_config_invalid_json() {
        let tool = create_mock_tool(Some("invalid json".to_string()));
        assert!(tool.parse_mcp_config().is_none());
    }

    #[test]
    fn test_tool_get_transport_type_http() {
        let config = McpConfig::http();
        let tool = create_mock_tool(Some(config.to_json().unwrap()));
        assert_eq!(tool.get_transport_type(), McpTransportType::Http);
    }

    #[test]
    fn test_tool_get_transport_type_stdio() {
        let config = McpConfig::stdio("npx".to_string());
        let tool = create_mock_tool(Some(config.to_json().unwrap()));
        assert_eq!(tool.get_transport_type(), McpTransportType::Stdio);
    }

    #[test]
    fn test_tool_get_transport_type_default_when_no_config() {
        let tool = create_mock_tool(None);
        assert_eq!(tool.get_transport_type(), McpTransportType::Http);
    }

    #[test]
    fn test_tool_get_transport_type_default_when_invalid_config() {
        let tool = create_mock_tool(Some("{}".to_string()));
        // Empty JSON object should fail to parse transport, defaulting to Http
        assert_eq!(tool.get_transport_type(), McpTransportType::Http);
    }
}
