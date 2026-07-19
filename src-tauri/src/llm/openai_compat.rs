//! Re-exported from `chatshell_agent_core`.
//!
//! The OpenAI Chat Completions-compatible `CompletionModel` - with custom
//! `reasoning_content` streaming support (MiniMax/DeepSeek reasoning dedup)
//! and `with_string_content_only()` for array-averse providers - lives in the
//! shared agent core so desktop and iOS use the same implementation. Mirrors
//! the `thinking_parser` re-export pattern.

pub use chatshell_agent_core::openai_compat::*;
