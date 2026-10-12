//! Yahoo search provider
//!
//! Scrapes result pages through the Obscura browser tier when configured,
//! falling back to headless Chrome with stealth mode to bypass bot detection.

use anyhow::Result;
use chrono::Utc;
use std::time::Duration;
use url::form_urlencoded;

use chatshell_agent_core::web_search as core_search;

use crate::web_fetch::{STEALTH_JS, create_new_browser};

use super::types::SearchResultItem;
use super::types::{SearchProvider, WebSearchResponse};

/// Perform Yahoo search using headless Chrome
///
/// # Arguments
/// * `query` - The search query string
/// * `max_results` - Maximum number of results to return
///
/// # Returns
/// A `WebSearchResponse` containing the search results
pub async fn search_yahoo(query: &str, max_results: usize) -> Result<WebSearchResponse> {
    let searched_at = Utc::now().to_rfc3339();
    let encoded_query: String = form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let search_url = format!("https://search.yahoo.com/search?p={}", encoded_query);

    // Fetch tier chain: HTTP → obscura (if installed) → system WebView
    if let Some(results) = super::utils::scrape_search_results(
        &search_url,
        core_search::parse_yahoo_results,
        max_results,
    )
    .await
    {
        let total_results = results.len();
        return Ok(WebSearchResponse {
            query: query.to_string(),
            results,
            total_results,
            searched_at,
            provider: SearchProvider::Yahoo,
        });
    }

    // Fall back to headless Chrome (blocking thread since headless_chrome is sync)
    let results =
        tokio::task::spawn_blocking(move || search_yahoo_sync(&search_url, max_results)).await??;

    let total_results = results.len();

    Ok(WebSearchResponse {
        query: query.to_string(),
        results,
        total_results,
        searched_at,
        provider: SearchProvider::Yahoo,
    })
}

/// Synchronous Yahoo search implementation via headless Chrome
fn search_yahoo_sync(search_url: &str, max_results: usize) -> Result<Vec<SearchResultItem>> {
    tracing::info!("🔍 [web_search] Starting Yahoo search for: {}", search_url);

    let browser = create_new_browser()?;

    let tab = browser
        .new_tab()
        .map_err(|e| anyhow::anyhow!("Failed to create tab: {}", e))?;

    // Set realistic User-Agent before navigation
    tab.set_user_agent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Some("en-US,en;q=0.9"),
        Some("macOS"),
    ).map_err(|e| anyhow::anyhow!("Failed to set user agent: {}", e))?;

    // Navigate to blank page first to inject stealth JS
    tab.navigate_to("about:blank")
        .map_err(|e| anyhow::anyhow!("Failed to navigate to blank: {}", e))?;
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Blank navigation timeout: {}", e))?;

    // Inject stealth JavaScript to hide headless detection
    tab.evaluate(&STEALTH_JS, false)
        .map_err(|e| anyhow::anyhow!("Failed to inject stealth JS: {}", e))?;

    tracing::info!("🛡️ [web_search] Stealth mode enabled, navigating to Yahoo...");

    tracing::info!("🌐 [web_search] Navigating to: {}", search_url);

    // Navigate to search URL
    tab.navigate_to(search_url)
        .map_err(|e| anyhow::anyhow!("Failed to navigate: {}", e))?;

    // Wait for navigation to complete
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Navigation timeout: {}", e))?;

    // Wait for results to load
    tracing::info!("⏳ [web_search] Waiting for search results to load...");
    std::thread::sleep(Duration::from_secs(3));

    let html = tab
        .get_content()
        .map_err(|e| anyhow::anyhow!("Failed to get page content: {}", e))?;

    tracing::info!("📄 [web_search] Got {} bytes of HTML", html.len());

    // Parse via the shared core parser (single home for extraction semantics)
    let results: Vec<SearchResultItem> = core_search::parse_yahoo_results(&html, max_results)
        .into_iter()
        .map(|r| SearchResultItem {
            title: r.title,
            url: r.url,
            snippet: r.snippet,
        })
        .collect();
    tracing::info!("✅ [web_search] Found {} results", results.len());

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_yahoo_redirect_url() {
        let href = "https://r.search.yahoo.com/_ylt=abc/RU=https%3A%2F%2Fexample.com%2Fpage/RK=0";
        let result = core_search::resolve_yahoo_redirect_url(href);
        assert_eq!(result, "https://example.com/page");
    }

    #[test]
    fn test_extract_yahoo_direct_url() {
        let href = "https://example.com/page";
        let result = core_search::resolve_yahoo_redirect_url(href);
        assert_eq!(result, "https://example.com/page");
    }
}
