//! MCP tool execution.
//!
//! Routes invocations to the correct MCP server. The model should read the
//! tool schema via `mcp_schema` first, then call this tool with the server,
//! tool name, and arguments.

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

#[derive(Debug, thiserror::Error)]
pub enum McpToolUseError {
    #[error("Unknown MCP tool: {0}. Check the available tools via mcp_schema.")]
    UnknownTool(String),
    #[error("MCP tool call failed: {0}")]
    CallFailed(String),
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
}

impl McpToolUseTool {
    pub fn new(clients: McpClientMap) -> Self {
        Self { clients }
    }
}

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
