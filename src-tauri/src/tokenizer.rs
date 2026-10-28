// CJK-aware tokenizer for the local FTS message index, shared with the
// other platforms through `chatshell-agent-core` so `messages_fts` content
// and `MATCH` queries segment identically everywhere.

pub use chatshell_agent_core::tokenizer::{tokenize_for_search, tokenize_query};
