//! Load MCP schema tool for LLM agents.
//!
//! Loads the definition (parameters and schema) for an MCP tool by name. Used when
//! MCP lazy loading is active so the LLM can fetch tool schemas without using the general read tool.

use std::collections::HashMap;

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Clone, Deserialize)]
pub struct LoadMcpSchemaArgs {
    /// Server name (section header in the Available MCP Tools catalog, e.g. "GitHub")
    pub server_name: String,
    /// Name of the MCP tool (as listed under that server in the catalog)
    pub tool_name: String,
}

#[derive(Debug, thiserror::Error)]
#[error("Load MCP schema error: {0}")]
pub struct LoadMcpSchemaError(String);

#[derive(Clone)]
pub struct LoadMcpSchemaTool {
    /// Maps MCP tool name -> JSON schema string
    schemas: HashMap<String, String>,
}

impl LoadMcpSchemaTool {
    pub fn new(schemas: HashMap<String, String>) -> Self {
        Self { schemas }
    }
}

impl Tool for LoadMcpSchemaTool {
    const NAME: &'static str = "load_mcp_schema";

    type Error = LoadMcpSchemaError;
    type Args = LoadMcpSchemaArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "load_mcp_schema".to_string(),
            description:
                "Load the definition (parameters and schema) for an MCP tool by server and name. \
                Use this before calling an MCP tool to understand its required parameters. \
                Pass the server name (section header in the catalog) and the tool name."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "server_name": {
                        "type": "string",
                        "description": "The MCP server name (section header in the Available MCP Tools catalog, e.g. GitHub)"
                    },
                    "tool_name": {
                        "type": "string",
                        "description": "The name of the MCP tool (as listed under that server)"
                    }
                },
                "required": ["server_name", "tool_name"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let key = format!("{}/{}", args.server_name, args.tool_name);
        tracing::info!(
            "🔧 [tool-call] load_mcp_schema: server_name=\"{}\", tool_name=\"{}\"",
            args.server_name,
            args.tool_name
        );

        let schema = self
            .schemas
            .get(&key)
            .ok_or_else(|| LoadMcpSchemaError(format!("Unknown MCP tool: {}", key)))?
            .clone();

        Ok(schema)
    }
}
