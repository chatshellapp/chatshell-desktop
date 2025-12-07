//! Common types for web search functionality

use serde::{Deserialize, Serialize};
use std::fmt;

/// Supported search engine providers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SearchProvider {
    #[default]
    DuckDuckGo,
    Yahoo,
    Baidu,
}

impl SearchProvider {
    /// Get all available providers
    pub fn all() -> Vec<SearchProvider> {
        vec![
            SearchProvider::DuckDuckGo,
            SearchProvider::Yahoo,
            SearchProvider::Baidu,
        ]
    }

    /// Get the provider's display name
    pub fn display_name(&self) -> &'static str {
        match self {
            SearchProvider::DuckDuckGo => "DuckDuckGo",
            SearchProvider::Yahoo => "Yahoo",
            SearchProvider::Baidu => "Baidu",
        }
    }

    /// Get the provider's identifier (used in settings)
    pub fn id(&self) -> &'static str {
        match self {
            SearchProvider::DuckDuckGo => "duckduckgo",
            SearchProvider::Yahoo => "yahoo",
            SearchProvider::Baidu => "baidu",
        }
    }

    /// Parse from string identifier
    pub fn from_id(id: &str) -> Option<SearchProvider> {
        match id.to_lowercase().as_str() {
            "duckduckgo" => Some(SearchProvider::DuckDuckGo),
            "yahoo" => Some(SearchProvider::Yahoo),
            "baidu" => Some(SearchProvider::Baidu),
            _ => None,
        }
    }
}

impl fmt::Display for SearchProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.id())
    }
}

/// A single search result item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Generic response from web search (works for all providers)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchResponse {
    pub query: String,
    pub results: Vec<SearchResultItem>,
    pub total_results: usize,
    pub searched_at: String,
    pub provider: SearchProvider,
}

/// Response from DuckDuckGo search (legacy, for backwards compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuckDuckGoSearchResponse {
    pub query: String,
    pub results: Vec<SearchResultItem>,
    pub total_results: usize,
    pub searched_at: String,
}

impl From<DuckDuckGoSearchResponse> for WebSearchResponse {
    fn from(response: DuckDuckGoSearchResponse) -> Self {
        WebSearchResponse {
            query: response.query,
            results: response.results,
            total_results: response.total_results,
            searched_at: response.searched_at,
            provider: SearchProvider::DuckDuckGo,
        }
    }
}

/// Result from AI search decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDecisionResult {
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
}
