//! Native tools for LLM agents
//!
//! This module provides tool implementations that can be used by rig agents.
//! Unlike MCP tools which are external, these are built-in tools that wrap
//! existing functionality.
//!
//! ## Usage
//!
//! Tools can be added to an agent using the agent builder:
//!
//! ```rust,ignore
//! let config = AgentConfig::new()
//!     .with_web_search()
//!     .with_web_fetch()
//!     .with_bash()
//!     .with_read()
//!     .with_edit()
//!     .with_write()
//!     .with_grep()
//!     .with_glob();
//! ```
//!
//! Or enable all built-in tools at once:
//!
//! ```rust,ignore
//! let config = AgentConfig::new()
//!     .with_builtin_tools();
//! ```

pub(crate) mod bash;
mod bash_session_manager;
mod edit;
mod glob;
mod grep;
mod kill_shell;
mod mcp_schema;
mod mcp_tool_use;
mod skill;
mod read;
mod web_fetch;
mod web_search;
mod write;

pub use bash::BashTool;
pub use bash_session_manager::BashSessionManager;
pub use edit::EditTool;
pub use glob::GlobTool;
pub use grep::GrepTool;
pub use kill_shell::KillShellTool;
pub use mcp_schema::{McpSchemaTool, McpServerCatalog};
pub use mcp_tool_use::McpToolUseTool;
pub use skill::{SkillCatalogEntry, SkillTool};
pub use read::ReadTool;
pub use web_fetch::WebFetchTool;
pub use web_search::WebSearchTool;
pub use write::WriteTool;
