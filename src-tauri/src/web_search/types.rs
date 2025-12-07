//! Common types for web search functionality

use serde::{Deserialize, Serialize};

/// A single search result item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Response from DuckDuckGo search
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuckDuckGoSearchResponse {
    pub query: String,
    pub results: Vec<SearchResultItem>,
    pub total_results: usize,
    pub searched_at: String,
}

/// Result from AI search decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDecisionResult {
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
}

