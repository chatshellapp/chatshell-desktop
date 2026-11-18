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

/// One-line summary of a tool's annotations from its definition JSON, e.g.
/// `Hints (server-declared, unverified): read-only, idempotent`. `None` when
/// the definition carries no annotations (or none we summarize).
fn annotation_summary(definition: &serde_json::Value) -> Option<String> {
    let a = definition.get("annotations")?.as_object()?;
    let flag = |key: &str| a.get(key).and_then(serde_json::Value::as_bool);
    let mut parts: Vec<&str> = Vec::new();
    match flag("readOnlyHint") {
        Some(true) => parts.push("read-only"),
        Some(false) => parts.push("may modify"),
        None => {}
    }
    match flag("destructiveHint") {
        Some(true) => parts.push("destructive"),
        Some(false) => parts.push("not destructive"),
        None => {}
    }
    if flag("idempotentHint") == Some(true) {
        parts.push("idempotent");
    }
    match flag("openWorldHint") {
        Some(true) => parts.push("open-world"),
        Some(false) => parts.push("closed-world"),
        None => {}
    }
    if parts.is_empty() {
        return None;
    }
    Some(format!(
        "Hints (server-declared, unverified): {}",
        parts.join(", ")
    ))
}

/// Resources shown per server in the catalog (URIs are what
/// `mcp_resource_read` takes).
const MAX_RESOURCES_PER_SERVER: usize = 30;

fn push_resource_line(desc: &mut String, label: &str, items: &[(String, String)]) {
    if items.is_empty() {
        return;
    }
    let shown: Vec<String> = items
        .iter()
        .take(MAX_RESOURCES_PER_SERVER)
        .map(|(uri, name)| {
            if name.is_empty() || name == uri {
                uri.clone()
            } else {
                format!("{name} <{uri}>")
            }
        })
        .collect();
    desc.push_str(&format!(
        "    {label} (read with mcp_resource_read): {}",
        shown.join(", ")
    ));
    if items.len() > MAX_RESOURCES_PER_SERVER {
        desc.push_str(&format!(
            ", ...+{} more",
            items.len() - MAX_RESOURCES_PER_SERVER
        ));
    }
    desc.push('\n');
}

#[derive(Debug, Deserialize)]
pub struct McpSchemaArgs {
    pub server: String,
    pub tool: String,
}

#[derive(Debug, Clone, Default)]
pub struct McpServerCatalog {
    pub name: String,
    pub tools: Vec<(String, String)>,
    /// (uri, name) of each listed resource.
    pub resources: Vec<(String, String)>,
    /// (uriTemplate, name) of each resource template.
    pub resource_templates: Vec<(String, String)>,
}

#[derive(Clone)]
pub struct McpSchemaTool {
    catalog: Vec<McpServerCatalog>,
    schema_dir: String,
    /// Selected servers that need the user to sign in again.
    needs_auth: Vec<String>,
    /// Selected servers that could not be reached this run.
    unreachable: Vec<String>,
}

impl McpSchemaTool {
    pub fn new(catalog: Vec<McpServerCatalog>, schema_dir: String) -> Self {
        Self {
            catalog,
            schema_dir,
            needs_auth: Vec::new(),
            unreachable: Vec::new(),
        }
    }

    /// Name the selected servers that failed this run, so the model reports
    /// the real cause instead of acting as if they were never selected.
    pub fn with_unavailable(mut self, needs_auth: Vec<String>, unreachable: Vec<String>) -> Self {
        self.needs_auth = needs_auth;
        self.unreachable = unreachable;
        self
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
            push_resource_line(&mut desc, "resources", &server.resources);
            push_resource_line(&mut desc, "resource_templates", &server.resource_templates);
        }
        if server_count > MAX_SERVERS {
            desc.push_str(&format!(
                "  ...+{} more servers\n",
                server_count - MAX_SERVERS
            ));
        }
        desc.push_str("</available_mcp_tools>");
        if !self.needs_auth.is_empty() {
            desc.push_str(&format!(
                "\n\nRequires sign-in: {}. These servers rejected ChatShell's credentials; \
                 their tools are unavailable until the user signs in to them again in ChatShell.",
                self.needs_auth.join(", ")
            ));
        }
        if !self.unreachable.is_empty() {
            desc.push_str(&format!(
                "\n\nNot reachable right now: {}.",
                self.unreachable.join(", ")
            ));
        }
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
        let summary = serde_json::from_str::<serde_json::Value>(&content)
            .ok()
            .as_ref()
            .and_then(annotation_summary)
            .map(|line| format!("{line}\n"))
            .unwrap_or_default();

        let mut bounded = content;
        if bounded.len() > MAX_SCHEMA_CHARS {
            let mut end = MAX_SCHEMA_CHARS;
            while end > 0 && !bounded.is_char_boundary(end) {
                end -= 1;
            }
            bounded.truncate(end);
            Ok(format!(
                "<mcp_schema server=\"{}\" tool=\"{}\">\n{summary}{}\n[schema truncated at {} chars — the server published an unusually large schema; call the tool with conservative arguments or inspect the server source]\n</mcp_schema>",
                args.server, args.tool, bounded, MAX_SCHEMA_CHARS
            ))
        } else {
            Ok(format!(
                "<mcp_schema server=\"{}\" tool=\"{}\">\n{summary}{}\n</mcp_schema>",
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
            ..Default::default()
        }
    }

    #[test]
    fn description_lists_resources_and_templates_per_server() {
        let catalog = McpServerCatalog {
            name: "docs".to_string(),
            tools: vec![],
            resources: vec![
                ("mem://guide".to_string(), "Guide".to_string()),
                ("mem://raw".to_string(), "mem://raw".to_string()),
            ],
            resource_templates: vec![("mem://{key}".to_string(), "by key".to_string())],
        };
        let tool = McpSchemaTool::new(vec![catalog], "/tmp".to_string());
        let desc = rig::agent::tool::Tool::description(&tool);
        assert!(
            desc.contains(
                "resources (read with mcp_resource_read): Guide <mem://guide>, mem://raw"
            ),
            "{desc}"
        );
        assert!(
            desc.contains("resource_templates (read with mcp_resource_read): by key <mem://{key}>")
        );
    }

    #[test]
    fn description_caps_resources_per_server() {
        let catalog = McpServerCatalog {
            name: "big".to_string(),
            resources: (0..40)
                .map(|i| (format!("mem://r{i}"), String::new()))
                .collect(),
            ..Default::default()
        };
        let tool = McpSchemaTool::new(vec![catalog], "/tmp".to_string());
        let desc = rig::agent::tool::Tool::description(&tool);
        assert!(desc.contains("mem://r29"));
        assert!(!desc.contains("mem://r30"));
        assert!(desc.contains("+10 more"));
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
            ..Default::default()
        };
        let tool = McpSchemaTool::new(vec![server_catalog], "/tmp".to_string());
        let desc = rig::agent::tool::Tool::description(&tool);
        assert!(desc.contains("tool_0"));
        assert!(!desc.contains("tool_70"), "beyond the per-server cap");
        assert!(desc.contains("+20 more"), "overflow indicated");
    }

    #[test]
    fn description_names_unavailable_servers_by_cause() {
        let tool = McpSchemaTool::new(vec![], "/tmp".to_string())
            .with_unavailable(vec!["github".into()], vec!["slow".into()]);
        let desc = rig::agent::tool::Tool::description(&tool);
        assert!(desc.contains("Requires sign-in: github."), "{desc}");
        assert!(desc.contains("Not reachable right now: slow."), "{desc}");
    }

    #[test]
    fn description_omits_notices_when_all_servers_connected() {
        let tool = McpSchemaTool::new(vec![server("srv", vec![("a", "")])], "/tmp".to_string());
        let desc = rig::agent::tool::Tool::description(&tool);
        assert!(!desc.contains("Requires sign-in"));
        assert!(!desc.contains("Not reachable"));
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
        assert!(!out.contains("Hints"), "no annotations, no summary line");
    }

    #[test]
    fn annotation_summary_lists_declared_hints() {
        let def = json!({"annotations": {
            "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true
        }});
        assert_eq!(
            annotation_summary(&def).as_deref(),
            Some("Hints (server-declared, unverified): read-only, not destructive, idempotent")
        );
        assert_eq!(annotation_summary(&json!({"annotations": {}})), None);
        assert_eq!(annotation_summary(&json!({})), None);
    }

    #[tokio::test]
    async fn schema_output_leads_with_annotation_summary() {
        let dir = tempfile::tempdir().unwrap();
        let schema_dir = dir.path().join("srv");
        std::fs::create_dir_all(&schema_dir).unwrap();
        std::fs::write(
            schema_dir.join("tool.json"),
            json!({"name": "tool", "annotations": {"destructiveHint": true}}).to_string(),
        )
        .unwrap();
        let tool = McpSchemaTool::new(
            vec![server("srv", vec![("tool", "desc")])],
            dir.path().to_string_lossy().to_string(),
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
        assert!(
            out.contains("\nHints (server-declared, unverified): destructive\n{"),
            "{out}"
        );
    }
}
