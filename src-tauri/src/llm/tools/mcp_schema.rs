//! MCP schema lookup tool with embedded catalog.
//!
//! Provides progressive disclosure for MCP tools: the tool description contains
//! an XML catalog of all available MCP tools, and calling it returns the full
//! JSON schema for a specific tool. The model should always call this before
//! using `mcp_tool_use` to understand the required parameters.

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum McpSchemaError {
    #[error("Schema not found for {server}/{tool}. Check available tools in the catalog.")]
    NotFound { server: String, tool: String },
    #[error("Failed to read schema: {0}")]
    ReadError(String),
}

#[derive(Debug, Deserialize)]
pub struct McpSchemaArgs {
    pub server: String,
    pub tool: String,
}

#[derive(Debug, Clone)]
pub struct McpServerCatalog {
    pub name: String,
    pub tools: Vec<(String, String)>,
}

#[derive(Clone)]
pub struct McpSchemaTool {
    catalog: Vec<McpServerCatalog>,
    schema_dir: String,
}

impl McpSchemaTool {
    pub fn new(catalog: Vec<McpServerCatalog>, schema_dir: String) -> Self {
        Self {
            catalog,
            schema_dir,
        }
    }
}

impl Tool for McpSchemaTool {
    const NAME: &'static str = "mcp_schema";

    type Error = McpSchemaError;
    type Args = McpSchemaArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        let mut desc = String::from(
            "Look up the schema for an MCP tool before calling it with mcp_tool_use. \
             You MUST call this first to understand the required parameters.\n\n\
             <available_mcp_tools>\n",
        );
        for server in &self.catalog {
            desc.push_str(&format!("  <server name=\"{}\">\n", server.name));
            for (tool_name, tool_desc) in &server.tools {
                desc.push_str(&format!(
                    "    <tool name=\"{}\">{}</tool>\n",
                    tool_name, tool_desc
                ));
            }
            desc.push_str("  </server>\n");
        }
        desc.push_str("</available_mcp_tools>");

        ToolDefinition {
            name: "mcp_schema".to_string(),
            description: desc,
            parameters: json!({
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "The MCP server name from the catalog"
                    },
                    "tool": {
                        "type": "string",
                        "description": "The exact name of the MCP tool"
                    }
                },
                "required": ["server", "tool"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let path = std::path::Path::new(&self.schema_dir)
            .join(&args.server)
            .join(format!("{}.json", args.tool));

        tracing::info!(
            "📋 [mcp_schema] Reading schema for '{}/{}' from {}",
            args.server,
            args.tool,
            path.display()
        );

        let content = tokio::fs::read_to_string(&path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                McpSchemaError::NotFound {
                    server: args.server.clone(),
                    tool: args.tool.clone(),
                }
            } else {
                McpSchemaError::ReadError(e.to_string())
            }
        })?;

        Ok(format!(
            "<mcp_schema server=\"{}\" tool=\"{}\">\n{}\n</mcp_schema>",
            args.server, args.tool, content
        ))
    }
}
