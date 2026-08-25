//! MCP schema lookup tool with embedded catalog.
//!
//! Provides progressive disclosure for MCP tools: the tool description contains
//! an XML catalog of all available MCP tools, and calling it returns the full
//! JSON schema for a specific tool. The model should always call this before
//! using `mcp_tool_use` to understand the required parameters.

use rig::agent::tool::Tool;
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

    fn description(&self) -> String {
        // Names-only catalog: the schema (with full descriptions and JSON
        // parameters) is what this tool returns when called, so embedding
        // descriptions here would bill them on every request. Discovery only
        // needs the names.
        const MAX_SERVERS: usize = 30;
        const MAX_TOOLS_PER_SERVER: usize = 60;

        let mut desc = String::from(
            "Look up the schema for an MCP tool before calling it with mcp_tool_use. \
             You MUST call this first to understand the required parameters.\n\n\
             <available_mcp_tools>\n",
        );
        let server_count = self.catalog.len();
        for server in self.catalog.iter().take(MAX_SERVERS) {
            desc.push_str(&format!("  <server name=\"{}\">", server.name));
            let tool_count = server.tools.len();
            let names: Vec<&str> = server
                .tools
                .iter()
                .take(MAX_TOOLS_PER_SERVER)
                .map(|(name, _)| name.as_str())
                .collect();
            desc.push_str(&names.join(", "));
            if tool_count > MAX_TOOLS_PER_SERVER {
                desc.push_str(&format!(", ...+{} more", tool_count - MAX_TOOLS_PER_SERVER));
            }
            desc.push('\n');
        }
        if server_count > MAX_SERVERS {
            desc.push_str(&format!(
                "  ...+{} more servers\n",
                server_count - MAX_SERVERS
            ));
        }
        desc.push_str("</available_mcp_tools>");
        desc
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
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
        })
    }

    async fn call(
        &self,
        _context: &mut rig::agent::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
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

        // Untrusted-content cap: the schema JSON comes from an MCP server we
        // do not control; bound what enters the model's context (UTF-8
        // boundary safe).
        const MAX_SCHEMA_CHARS: usize = 8_000;
        let mut bounded = content;
        if bounded.len() > MAX_SCHEMA_CHARS {
            let mut end = MAX_SCHEMA_CHARS;
            while end > 0 && !bounded.is_char_boundary(end) {
                end -= 1;
            }
            bounded.truncate(end);
            Ok(format!(
                "<mcp_schema server=\"{}\" tool=\"{}\">\n{}\n[schema truncated at {} chars — the server published an unusually large schema; call the tool with conservative arguments or inspect the server source]\n</mcp_schema>",
                args.server, args.tool, bounded, MAX_SCHEMA_CHARS
            ))
        } else {
            Ok(format!(
                "<mcp_schema server=\"{}\" tool=\"{}\">\n{}\n</mcp_schema>",
                args.server, args.tool, bounded
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig::agent::tool::ToolContext;

    fn server(name: &str, tools: Vec<(&str, &str)>) -> McpServerCatalog {
        McpServerCatalog {
            name: name.to_string(),
            tools: tools
                .into_iter()
                .map(|(n, d)| (n.to_string(), d.to_string()))
                .collect(),
        }
    }

    #[test]
    fn description_lists_names_without_full_tool_descriptions() {
        let long_desc = "A very long tool description. ".repeat(40);
        let tool = McpSchemaTool::new(
            vec![server(
                "srv",
                vec![("tool_a", long_desc.as_str()), ("tool_b", "short")],
            )],
            "/tmp".to_string(),
        );
        let desc = rig::agent::tool::Tool::description(&tool);
        assert!(desc.contains("tool_a"));
        assert!(desc.contains("tool_b"));
        assert!(
            !desc.contains("A very long tool description"),
            "full descriptions must not ride the schema: {desc}"
        );
        assert!(desc.contains("srv"));
    }

    #[test]
    fn description_caps_tool_names_per_server() {
        let tools: Vec<(String, String)> = (0..80)
            .map(|i| (format!("tool_{i}"), String::new()))
            .collect();
        let server_catalog = McpServerCatalog {
            name: "big".to_string(),
            tools,
        };
        let tool = McpSchemaTool::new(vec![server_catalog], "/tmp".to_string());
        let desc = rig::agent::tool::Tool::description(&tool);
        assert!(desc.contains("tool_0"));
        assert!(!desc.contains("tool_70"), "beyond the per-server cap");
        assert!(desc.contains("+20 more"), "overflow indicated");
    }
    #[tokio::test]
    async fn oversized_schema_is_capped_with_notice() {
        let dir = tempfile::tempdir().unwrap();
        let schema_dir = dir.path().join("schemas").join("srv");
        std::fs::create_dir_all(&schema_dir).unwrap();
        // Multibyte content exercises the UTF-8 boundary walk.
        let big: String = "\u{30C6}\u{30B9}\u{30C8}".repeat(4_000);
        std::fs::write(schema_dir.join("tool.json"), &big).unwrap();

        let tool = McpSchemaTool::new(
            vec![server("srv", vec![("tool", "desc")])],
            dir.path().join("schemas").to_string_lossy().to_string(),
        );
        let out = <McpSchemaTool as Tool>::call(
            &tool,
            &mut ToolContext::default(),
            McpSchemaArgs {
                server: "srv".to_string(),
                tool: "tool".to_string(),
            },
        )
        .await
        .unwrap();

        assert!(out.contains("schema truncated at 8000 chars"), "{out}");
        assert!(!out.contains('\u{FFFD}'), "no replacement chars");
    }

    #[tokio::test]
    async fn small_schema_passes_uncapped() {
        let dir = tempfile::tempdir().unwrap();
        let schema_dir = dir.path().join("schemas").join("srv");
        std::fs::create_dir_all(&schema_dir).unwrap();
        std::fs::write(schema_dir.join("tool.json"), "{\"type\":\"object\"}").unwrap();

        let tool = McpSchemaTool::new(
            vec![server("srv", vec![("tool", "desc")])],
            dir.path().join("schemas").to_string_lossy().to_string(),
        );
        let out = <McpSchemaTool as Tool>::call(
            &tool,
            &mut ToolContext::default(),
            McpSchemaArgs {
                server: "srv".to_string(),
                tool: "tool".to_string(),
            },
        )
        .await
        .unwrap();

        assert!(out.contains("{\"type\":\"object\"}"));
        assert!(!out.contains("truncated"));
    }
}
