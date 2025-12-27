//! Baidu search provider
//!
//! Implements web search using headless Chrome with stealth mode
//! to bypass bot detection.

use anyhow::Result;
use chrono::Utc;
use scraper::{Html, Selector};
use std::time::Duration;
use url::form_urlencoded;

use crate::web_fetch::{STEALTH_JS, create_new_browser};

use super::types::{SearchProvider, SearchResultItem, WebSearchResponse};

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

    // Parse search results
    let results = parse_baidu_results(&html, max_results);
    tracing::info!("✅ [web_search] Found {} results", results.len());

    Ok(results)
}

/// Parse Baidu HTML search results
fn parse_baidu_results(html: &str, max_results: usize) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);
    let mut results = Vec::new();

    // Baidu search results are in div.result or div.c-container elements
    // Each result contains:
    // - h3.t > a for the title and URL
    // - div.c-abstract or span.content-right_8Zs40 for the snippet

    let result_selector = Selector::parse("div.result, div.c-container").unwrap();
    let title_selector = Selector::parse("h3 a, h3.c-title a").unwrap();
    let snippet_selector =
        Selector::parse("div.c-abstract, span.content-right_8Zs40, div.c-span-last").unwrap();

    for result_el in document.select(&result_selector).take(max_results * 2) {
        // Extract title and URL
        let (title, url) = match result_el.select(&title_selector).next() {
            Some(el) => {
                let title = el.text().collect::<String>().trim().to_string();
                let href = el.value().attr("href").unwrap_or_default();
                // Baidu uses redirect URLs, we'll use them as-is
                // The actual URL resolution would require following the redirect
                (title, href.to_string())
            }
            None => continue,
        };

        // Skip if URL is empty
        if url.is_empty() {
            continue;
        }

        // Skip Baidu's own pages
        if url.contains("baidu.com/sf")
            || url.contains("baike.baidu.com")
            || url.contains("tieba.baidu.com")
        {
            continue;
        }

        // Extract snippet
        let snippet = result_el
            .select(&snippet_selector)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        if !title.is_empty() {
            results.push(SearchResultItem {
                title,
                url,
                snippet,
            });

            if results.len() >= max_results {
                break;
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_html() {
        let results = parse_baidu_results("<html></html>", 5);
        assert!(results.is_empty());
    }
}
