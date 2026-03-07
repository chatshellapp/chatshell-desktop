//! MCP meta-tool for lazy-loaded MCP tool calling.
//!
//! Instead of registering all MCP tool schemas with the agent (which can consume
//! tens of thousands of tokens), this single tool routes invocations to the
//! correct MCP server. The agent discovers tool schemas by reading definition
//! files from disk, then calls this meta-tool with the tool name and arguments.

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
pub enum McpCallError {
    #[error("Unknown MCP tool: {0}. Check the available tools listed in the system prompt.")]
    UnknownTool(String),
    #[error("MCP tool call failed: {0}")]
    CallFailed(String),
}

#[derive(Debug, Deserialize)]
pub struct McpCallArgs {
    /// The MCP server name (section header in the Available MCP Tools catalog)
    pub server_name: String,
    /// The exact name of the MCP tool to call (as exposed by the server)
    pub tool_name: String,
    /// The arguments to pass to the tool, matching its inputSchema
    #[serde(default)]
    pub arguments: serde_json::Value,
}

/// Maps tool_name -> (server_name, Peer<RoleClient>)
pub type McpClientMap = Arc<RwLock<HashMap<String, (String, Peer<RoleClient>)>>>;

#[derive(Clone)]
pub struct McpCallTool {
    clients: McpClientMap,
}

impl McpCallTool {
    pub fn new(clients: McpClientMap) -> Self {
        Self { clients }
    }
}

impl Tool for McpCallTool {
    const NAME: &'static str = "call_mcp_tool";

    type Error = McpCallError;
    type Args = McpCallArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "call_mcp_tool".to_string(),
            description: "Call an MCP (Model Context Protocol) tool by server and name. \
                Before calling, use the `load_mcp_schema` tool to load the tool's definition. \
                Pass the server name (section header in the catalog) and the tool name."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "server_name": {
                        "type": "string",
                        "description": "The MCP server name (section header in the Available MCP Tools catalog)"
                    },
                    "tool_name": {
                        "type": "string",
                        "description": "The exact name of the MCP tool to call"
                    },
                    "arguments": {
                        "type": "object",
                        "description": "The arguments to pass to the tool, as specified in its definition's inputSchema"
                    }
                },
                "required": ["server_name", "tool_name"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let key = format!("{}/{}", args.server_name, args.tool_name);
        let clients = self.clients.read().await;
        let (_server_name, client) = clients
            .get(&key)
            .ok_or_else(|| McpCallError::UnknownTool(key.clone()))?;

        tracing::info!(
            "🔌 [call_mcp_tool] Calling '{}' on server '{}'",
            args.tool_name,
            args.server_name
        );

        let arguments = args.arguments.as_object().cloned().unwrap_or_default();

        let result = client
            .call_tool(CallToolRequestParams {
                name: args.tool_name.clone().into(),
                arguments: Some(arguments),
                meta: None,
                task: None,
            })
            .await
            .map_err(|e| McpCallError::CallFailed(format!("Tool returned an error: {e}")))?;

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

            return Err(McpCallError::CallFailed(if error_msg.is_empty() {
                "No error message returned".to_string()
            } else {
                error_msg
            }));
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
