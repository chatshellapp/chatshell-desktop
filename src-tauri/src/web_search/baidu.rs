//! Baidu search provider
//!
//! Implements web search using headless Chrome with stealth mode
//! to bypass bot detection.

use anyhow::Result;
use chrono::Utc;
use std::time::Duration;
use url::form_urlencoded;

use chatshell_agent_core::web_search as core_search;

use crate::web_fetch::{STEALTH_JS, create_new_browser};

use super::types::SearchResultItem;
use super::types::{SearchProvider, WebSearchResponse};

/// Perform Baidu search using headless Chrome
///
/// # Arguments
/// * `query` - The search query string
/// * `max_results` - Maximum number of results to return
///
/// # Returns
/// A `WebSearchResponse` containing the search results
pub async fn search_baidu(query: &str, max_results: usize) -> Result<WebSearchResponse> {
    let query_owned = query.to_string();
    let searched_at = Utc::now().to_rfc3339();

    // Run in blocking thread since headless_chrome is sync
    let results =
        tokio::task::spawn_blocking(move || search_baidu_sync(&query_owned, max_results)).await??;

    let total_results = results.len();

    Ok(WebSearchResponse {
        query: query.to_string(),
        results,
        total_results,
        searched_at,
        provider: SearchProvider::Baidu,
    })
}

/// Synchronous Baidu search implementation
fn search_baidu_sync(query: &str, max_results: usize) -> Result<Vec<SearchResultItem>> {
    tracing::info!("🔍 [web_search] Starting Baidu search for: {}", query);

    let browser = create_new_browser()?;

    let tab = browser
        .new_tab()
        .map_err(|e| anyhow::anyhow!("Failed to create tab: {}", e))?;

    // Set realistic User-Agent before navigation
    tab.set_user_agent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Some("zh-CN,zh;q=0.9,en;q=0.8"),
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

    tracing::info!("🛡️ [web_search] Stealth mode enabled, navigating to Baidu...");

    // Build search URL
    let encoded_query: String = form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let search_url = format!("https://www.baidu.com/s?wd={}", encoded_query);

    tracing::info!("🌐 [web_search] Navigating to: {}", search_url);

    // Navigate to search URL
    tab.navigate_to(&search_url)
        .map_err(|e| anyhow::anyhow!("Failed to navigate: {}", e))?;

    // Wait for navigation to complete
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Navigation timeout: {}", e))?;

    // Wait for results to load (Baidu may need a bit more time)
    tracing::info!("⏳ [web_search] Waiting for search results to load...");
    std::thread::sleep(Duration::from_secs(4));

    let html = tab
        .get_content()
        .map_err(|e| anyhow::anyhow!("Failed to get page content: {}", e))?;

    tracing::info!("📄 [web_search] Got {} bytes of HTML", html.len());

    // Parse via the shared core parser (single home for extraction semantics)
    let results: Vec<SearchResultItem> = core_search::parse_baidu_results(&html, max_results)
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
    fn test_parse_empty_html() {
        let results = core_search::parse_baidu_results("<html></html>", 5);
        assert!(results.is_empty());
    }
}
