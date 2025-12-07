//! Web search module
//!
//! This module provides web search functionality with support for multiple providers.
//! Currently implements DuckDuckGo search using headless Chrome with stealth mode
//! to bypass bot detection.

mod decision;
mod duckduckgo;
mod types;
mod utils;

// Re-export types
pub use types::{DuckDuckGoSearchResponse, SearchDecisionResult, SearchResultItem};

// Re-export functions
pub use decision::decide_search_needed;
pub use duckduckgo::search_duckduckgo;
pub use utils::extract_search_keywords;

