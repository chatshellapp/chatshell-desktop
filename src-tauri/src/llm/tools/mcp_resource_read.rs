//! MCP resource reads (`resources/read`).
//!
//! The model finds resources in the `mcp_schema` catalog and reads one by
//! server name and URI. The URI passes the same scanning as MCP tool
//! arguments; a `file://` URI is a local read and goes through the read
//! path policy exactly like the `read` tool (the permission gate already
//! prompted for ask-tier paths). Text is inlined with a cap; binary
//! contents are saved to the conversation's tool-output store.

use std::collections::HashMap;
use std::sync::Arc;

use chatshell_agent_core::mcp::{
    read_resource_with_options, render_read_resource_result, scan_resource_uri,
};
use chatshell_agent_core::tools::SpillTarget;
use rig::agent::tool::Tool;
use rmcp::service::ServiceError;
use serde::Deserialize;
use serde_json::json;

use super::McpClientEntry;

#[derive(Debug, thiserror::Error)]
pub enum McpResourceReadError {
    #[error("Unknown MCP server: {0}. Check the servers listed in mcp_schema.")]
    UnknownServer(String),
    #[error("MCP resource read blocked: {0}")]
    Blocked(String),
    #[error(
        "Reading '{uri}' from MCP server '{server}' timed out after {secs} s without a response."
    )]
    TimedOut {
        server: String,
        uri: String,
        secs: u64,
    },
    #[error("MCP resource read failed: {0}")]
    ReadFailed(String),
}

#[derive(Debug, Deserialize)]
pub struct McpResourceReadArgs {
    pub server: String,
    pub uri: String,
}

/// Server name -> how to reach it.
pub type McpServerMap = Arc<HashMap<String, McpClientEntry>>;

#[derive(Clone)]
pub struct McpResourceReadTool {
    servers: McpServerMap,
    spill: Option<SpillTarget>,
}

impl McpResourceReadTool {
    pub fn new(servers: McpServerMap) -> Self {
        Self {
            servers,
            spill: None,
        }
    }

    /// Where binary resource contents are saved.
    pub fn with_spill_target(mut self, target: SpillTarget) -> Self {
        self.spill = Some(target);
        self
    }
}

impl Tool for McpResourceReadTool {
    const NAME: &'static str = "mcp_resource_read";

    type Error = McpResourceReadError;
    type Args = McpResourceReadArgs;
    type Output = String;

    fn description(&self) -> String {
        "Read an MCP resource by server name and URI. Resources (and URI templates \
         to fill in) are listed per server in the mcp_schema catalog."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "description": "The MCP server name from the catalog"
                },
                "uri": {
                    "type": "string",
                    "description": "The resource URI (a listed URI, or a template with its variables filled in)"
                }
            },
            "required": ["server", "uri"]
        })
    }

    async fn call(
        &self,
        _context: &mut rig::agent::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        scan_resource_uri(&args.uri).map_err(McpResourceReadError::Blocked)?;
        let entry = self
            .servers
            .get(&args.server)
            .ok_or_else(|| McpResourceReadError::UnknownServer(args.server.clone()))?;

        tracing::info!(
            "📚 [mcp_resource_read] Reading '{}' from server '{}'",
            args.uri,
            args.server
        );

        let result = read_resource_with_options(&entry.peer, &args.uri, entry.call_options)
            .await
            .map_err(|e| match e {
                ServiceError::Timeout { timeout } => McpResourceReadError::TimedOut {
                    server: args.server.clone(),
                    uri: args.uri.clone(),
                    secs: timeout.as_secs(),
                },
                other => McpResourceReadError::ReadFailed(other.to_string()),
            })?;

        Ok(render_read_resource_result(&result, self.spill.as_ref()))
    }
}
