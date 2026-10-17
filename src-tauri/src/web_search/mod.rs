//! Web search module
//!
//! This module provides web search functionality with support for multiple providers.
//! Supported providers:
//! - DuckDuckGo (default)
//! - Yahoo
//! - Baidu
//!
//! Providers scrape result pages through a fetch tier chain: plain HTTP
//! first, then Obscura when the binary is installed (see
//! `web_fetch::obscura`), then the system WebView, falling back to headless
//! Chrome.

mod baidu;
mod decision;
mod duckduckgo;
mod types;
mod utils;
mod yahoo;

use anyhow::Result;

// Re-export types
pub use types::{SearchDecisionResult, SearchProvider, WebSearchResponse};

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

/// Result of a search that may have degraded to another engine.
#[derive(Debug, Clone)]
pub struct SearchWithFallback {
    /// The response that won — the first provider returning at least one
    /// result, or the last non-error response when every engine came back
    /// empty.
    pub response: WebSearchResponse,
    /// Attempts before the winner: `(provider, reason)`. Empty when the
    /// preferred provider worked on the first try.
    pub failures: Vec<(SearchProvider, String)>,
}

/// Engine order for one query: the preferred provider first, then the rest.
/// Pure so the fallback policy is testable without network access.
pub fn provider_order(preferred: SearchProvider) -> Vec<SearchProvider> {
    let mut order = vec![preferred];
    order.extend(
        SearchProvider::all()
            .into_iter()
            .filter(|provider| *provider != preferred),
    );
    order
}

/// Search with engine fallback. A provider that errors (blocked, layout
/// change, tier failure) or returns zero results is retried on the next
/// engine, so an empty list means every engine agreed there was nothing —
/// a fact the model can act on.
pub async fn search_with_fallback(
    preferred: SearchProvider,
    query: &str,
    max_results: usize,
) -> Result<SearchWithFallback> {
    let mut failures: Vec<(SearchProvider, String)> = Vec::new();
    let mut last_empty: Option<WebSearchResponse> = None;
    let mut last_error: Option<anyhow::Error> = None;

    for provider in provider_order(preferred) {
        match search(provider, query, max_results).await {
            Ok(response) if !response.results.is_empty() => {
                return Ok(SearchWithFallback { response, failures });
            }
            Ok(response) => {
                failures.push((provider, "no results".to_string()));
                last_empty = Some(response);
            }
            Err(error) => {
                failures.push((provider, error.to_string()));
                last_error = Some(error);
            }
        }
    }

    match last_empty {
        Some(response) => Ok(SearchWithFallback { response, failures }),
        None => Err(last_error.unwrap_or_else(|| anyhow::anyhow!("All search providers failed"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_order_starts_with_preferred_and_covers_all() {
        for preferred in SearchProvider::all() {
            let order = provider_order(preferred);
            assert_eq!(order.first(), Some(&preferred));
            assert_eq!(order.len(), SearchProvider::all().len());
            let mut unique = order.clone();
            unique.sort_by_key(|p| p.id());
            unique.dedup();
            assert_eq!(unique.len(), order.len(), "duplicate provider in order");
        }
    }

    #[test]
    fn provider_order_keeps_preferred_when_it_is_last_in_all() {
        let order = provider_order(SearchProvider::Baidu);
        assert_eq!(
            order,
            vec![
                SearchProvider::Baidu,
                SearchProvider::DuckDuckGo,
                SearchProvider::Yahoo
            ]
        );
    }
}
