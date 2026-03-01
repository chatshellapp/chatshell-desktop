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

mod bash;
mod glob;
mod grep;
mod read;
mod web_fetch;
mod web_search;

pub use bash::BashTool;
pub use glob::GlobTool;
pub use grep::GrepTool;
pub use read::ReadTool;
pub use web_fetch::WebFetchTool;
pub use web_search::WebSearchTool;
