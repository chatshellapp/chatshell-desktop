//! MiniMax CN provider constants (China version)
//!
//! The actual client creation and streaming is handled by agent_builder.rs
//! MiniMax CN uses OpenAI-compatible API, so we reuse the moonshot provider client.

/// Default MiniMax CN API base URL
pub const DEFAULT_BASE_URL: &str = "https://api.minimaxi.com/v1";
