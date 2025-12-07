//! Web search module
//!
//! This module provides web search functionality with support for multiple providers.
//! Supported providers:
//! - DuckDuckGo (default)
//! - Yahoo
//! - Baidu
//!
//! All providers use headless Chrome with stealth mode to bypass bot detection.

mod baidu;
mod decision;
mod duckduckgo;
mod types;
mod utils;
mod yahoo;

use anyhow::Result;

// Re-export types
pub use types::{
    DuckDuckGoSearchResponse, SearchDecisionResult, SearchProvider, WebSearchResponse,
};

// Re-export decision and utils functions
pub use decision::decide_search_needed;
pub use utils::extract_search_keywords;

// Re-export individual search functions
pub use baidu::search_baidu;
pub use duckduckgo::search_duckduckgo;
pub use yahoo::search_yahoo;

/// Perform web search using the specified provider
///
/// # Arguments
/// * `provider` - The search provider to use
/// * `query` - The search query string
/// * `max_results` - Maximum number of results to return
///
/// # Returns
/// A `WebSearchResponse` containing the search results
pub async fn search(
    provider: SearchProvider,
    query: &str,
    max_results: usize,
) -> Result<WebSearchResponse> {
    match provider {
        SearchProvider::DuckDuckGo => {
            let response = search_duckduckgo(query, max_results).await?;
            Ok(response.into())
        }
        SearchProvider::Yahoo => search_yahoo(query, max_results).await,
        SearchProvider::Baidu => search_baidu(query, max_results).await,
    }
}
