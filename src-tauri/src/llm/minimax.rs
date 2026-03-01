//! MiniMax provider constants (international version)
//!
//! The actual client creation and streaming is handled by agent_builder.rs
//! MiniMax uses OpenAI-compatible API, so we reuse the moonshot provider client.

/// Default MiniMax (international) API base URL
pub const DEFAULT_BASE_URL: &str = "https://api.minimax.io/v1";
