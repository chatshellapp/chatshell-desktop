//! MCP tool execution.
//!
//! Routes invocations to the correct MCP server. The model should read the
//! tool schema via `mcp_schema` first, then call this tool with the server,
//! tool name, and arguments.
//!
//! For STDIO-transport servers the arguments are scanned for dangerous
//! patterns (path blocklist + bash command analysis) before the call is
//! forwarded.  HTTP-transport servers are exempt because they cannot access
//! the local filesystem.

use std::collections::HashMap;
use std::sync::Arc;

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use rmcp::RoleClient;
use rmcp::model::{CallToolRequestParams, RawContent};
use rmcp::service::Peer;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::RwLock;

use crate::models::McpTransportType;

use super::bash_security::{self, SecurityContext, SecurityVerdict};
use super::path_policy;

#[derive(Debug, thiserror::Error)]
pub enum McpToolUseError {
    #[error("Unknown MCP tool: {0}. Check the available tools via mcp_schema.")]
    UnknownTool(String),
    #[error("MCP tool call failed: {0}")]
    CallFailed(String),
    #[error("MCP tool call blocked: {0}")]
    Blocked(String),
}

#[derive(Debug, Deserialize)]
pub struct McpToolUseArgs {
    pub server: String,
    pub tool: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

/// Maps "server/tool" -> (server_name, Peer<RoleClient>)
pub type McpClientMap = Arc<RwLock<HashMap<String, (String, Peer<RoleClient>)>>>;

#[derive(Clone)]
pub struct McpToolUseTool {
    clients: McpClientMap,
    transport_types: HashMap<String, McpTransportType>,
}

impl McpToolUseTool {
    pub fn new(clients: McpClientMap, transport_types: HashMap<String, McpTransportType>) -> Self {
        Self {
            clients,
            transport_types,
        }
    }
}

// ---------------------------------------------------------------------------
// STDIO argument scanning
// ---------------------------------------------------------------------------

const COMMAND_LIKE_TOOL_NAMES: &[&str] = &[
    "run",
    "exec",
    "execute",
    "shell",
    "bash",
    "command",
    "cmd",
    "terminal",
    "spawn",
    "system",
    "run_command",
    "run_shell",
    "execute_command",
];

fn security_context_for_tool(tool_name: &str) -> SecurityContext {
    let lower = tool_name.to_lowercase();
    if COMMAND_LIKE_TOOL_NAMES.iter().any(|p| lower.contains(p)) {
        SecurityContext::Command
    } else {
        SecurityContext::Untrusted
    }
}

fn collect_string_values(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => out.push(s.clone()),
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_string_values(v, out);
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                collect_string_values(v, out);
            }
        }
        _ => {}
    }
}

fn scan_mcp_arguments(
    tool_name: &str,
    args: &serde_json::Value,
    transport: McpTransportType,
) -> Result<(), String> {
    if transport == McpTransportType::Http {
        return Ok(());
    }

    let context = security_context_for_tool(tool_name);
    let mut strings = Vec::new();
    collect_string_values(args, &mut strings);

    for s in &strings {
        // Path policy check
        path_policy::check_blocked_path(s)?;

        // Bash security analysis (reuses the full AST pipeline)
        match bash_security::check_with_context(s, context) {
            SecurityVerdict::Block(msg) => {
                return Err(format!("Blocked: {msg}"));
            }
            SecurityVerdict::Warn(msg) => {
                tracing::warn!("🛡️ [mcp_tool_use] Security warning for STDIO argument: {msg}");
            }
            SecurityVerdict::Allow => {}
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

impl Tool for McpToolUseTool {
    const NAME: &'static str = "mcp_tool_use";

    type Error = McpToolUseError;
    type Args = McpToolUseArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "mcp_tool_use".to_string(),
            description: "Call an MCP tool by server and name. \
                          Always read the schema with mcp_schema first to understand \
                          the required parameters."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "The MCP server name"
                    },
                    "tool": {
                        "type": "string",
                        "description": "The exact name of the MCP tool to call"
                    },
                    "arguments": {
                        "type": "object",
                        "description": "The arguments to pass to the tool, as specified in its schema"
                    }
                },
                "required": ["server", "tool"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let key = format!("{}/{}", args.server, args.tool);

        // Security: scan arguments for STDIO servers
        let transport = self
            .transport_types
            .get(&key)
            .copied()
            .unwrap_or(McpTransportType::Http);

        scan_mcp_arguments(&args.tool, &args.arguments, transport)
            .map_err(McpToolUseError::Blocked)?;

        let clients = self.clients.read().await;
        let (_server_name, client) = clients
            .get(&key)
            .ok_or_else(|| McpToolUseError::UnknownTool(key.clone()))?;

        tracing::info!(
            "🔌 [mcp_tool_use] Calling '{}' on server '{}'",
            args.tool,
            args.server
        );

        let arguments = args.arguments.as_object().cloned().unwrap_or_default();

        let result = match client
            .call_tool(CallToolRequestParams {
                name: args.tool.clone().into(),
                arguments: Some(arguments),
                meta: None,
                task: None,
            })
            .await
        {
            Ok(r) => r,
            Err(e) => {
                return Err(McpToolUseError::CallFailed(format!(
                    "Tool returned an error: {e}"
                )));
            }
        };

        if let Some(true) = result.is_error {
            let error_msg: String = result
                .content
                .into_iter()
                .filter_map(|c| match c.raw {
                    RawContent::Text(raw) => Some(raw.text.to_string()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");

            let msg = if error_msg.is_empty() {
                "No error message returned".to_string()
            } else {
                error_msg
            };
            return Err(McpToolUseError::CallFailed(msg));
        }

        Ok(result
            .content
            .into_iter()
            .map(|c| match c.raw {
                RawContent::Text(raw) => raw.text.to_string(),
                RawContent::Image(raw) => {
                    format!("data:{};base64,{}", raw.mime_type, raw.data)
                }
                RawContent::Resource(raw) => match raw.resource {
                    rmcp::model::ResourceContents::TextResourceContents {
                        uri,
                        mime_type,
                        text,
                        ..
                    } => {
                        format!(
                            "{mime_type}{uri}:{text}",
                            mime_type = mime_type.map(|m| format!("data:{m};")).unwrap_or_default(),
                        )
                    }
                    rmcp::model::ResourceContents::BlobResourceContents {
                        uri,
                        mime_type,
                        blob,
                        ..
                    } => format!(
                        "{mime_type}{uri}:{blob}",
                        mime_type = mime_type.map(|m| format!("data:{m};")).unwrap_or_default(),
                    ),
                },
                _ => String::new(),
            })
            .collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn security_context_command_like_tools() {
        assert_eq!(
            security_context_for_tool("run_shell"),
            SecurityContext::Command
        );
        assert_eq!(
            security_context_for_tool("execute"),
            SecurityContext::Command
        );
        assert_eq!(security_context_for_tool("bash"), SecurityContext::Command);
    }

    #[test]
    fn security_context_normal_tools() {
        assert_eq!(
            security_context_for_tool("search"),
            SecurityContext::Untrusted
        );
        assert_eq!(
            security_context_for_tool("read_file"),
            SecurityContext::Untrusted
        );
        assert_eq!(
            security_context_for_tool("query"),
            SecurityContext::Untrusted
        );
    }

    #[test]
    fn collect_strings_flat() {
        let val = json!({"a": "hello", "b": 42, "c": true});
        let mut out = Vec::new();
        collect_string_values(&val, &mut out);
        assert_eq!(out, vec!["hello"]);
    }

    #[test]
    fn collect_strings_nested() {
        let val = json!({"a": {"b": {"c": "deep"}}, "d": ["x", "y"]});
        let mut out = Vec::new();
        collect_string_values(&val, &mut out);
        assert_eq!(out.len(), 3);
        assert!(out.contains(&"deep".to_string()));
        assert!(out.contains(&"x".to_string()));
        assert!(out.contains(&"y".to_string()));
    }

    #[test]
    fn scan_http_skipped() {
        let result = scan_mcp_arguments(
            "dangerous_tool",
            &json!({"path": "~/.ssh/id_rsa"}),
            McpTransportType::Http,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn scan_stdio_blocks_dangerous_path() {
        let result = scan_mcp_arguments(
            "write_file",
            &json!({"path": "~/.bashrc", "content": "evil"}),
            McpTransportType::Stdio,
        );
        assert!(result.is_err());
    }

    #[test]
    fn scan_stdio_blocks_dangerous_command() {
        let result = scan_mcp_arguments(
            "run_shell",
            &json!({"command": "rm -rf /"}),
            McpTransportType::Stdio,
        );
        assert!(result.is_err());
    }

    #[test]
    fn scan_stdio_allows_safe_args() {
        let result = scan_mcp_arguments(
            "search",
            &json!({"query": "hello world", "limit": 10}),
            McpTransportType::Stdio,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn scan_stdio_nested_dangerous_path() {
        let result = scan_mcp_arguments(
            "tool",
            &json!({"config": {"output": "/etc/shadow"}}),
            McpTransportType::Stdio,
        );
        assert!(result.is_err());
    }

    #[test]
    fn scan_stdio_normal_text_no_false_positive() {
        let result = scan_mcp_arguments(
            "chat",
            &json!({"message": "Tell me about the > operator in Python"}),
            McpTransportType::Stdio,
        );
        assert!(result.is_ok());
    }
}
