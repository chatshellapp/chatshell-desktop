//! Yahoo search provider
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

/// Perform Yahoo search using headless Chrome
///
/// # Arguments
/// * `query` - The search query string
/// * `max_results` - Maximum number of results to return
///
/// # Returns
/// A `WebSearchResponse` containing the search results
pub async fn search_yahoo(query: &str, max_results: usize) -> Result<WebSearchResponse> {
    let query_owned = query.to_string();
    let searched_at = Utc::now().to_rfc3339();

    // Run in blocking thread since headless_chrome is sync
    let results =
        tokio::task::spawn_blocking(move || search_yahoo_sync(&query_owned, max_results)).await??;

    let total_results = results.len();

    Ok(WebSearchResponse {
        query: query.to_string(),
        results,
        total_results,
        searched_at,
        provider: SearchProvider::Yahoo,
    })
}

/// Synchronous Yahoo search implementation
fn search_yahoo_sync(query: &str, max_results: usize) -> Result<Vec<SearchResultItem>> {
    tracing::info!("🔍 [web_search] Starting Yahoo search for: {}", query);

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

    // Build search URL
    let encoded_query: String = form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let search_url = format!("https://search.yahoo.com/search?p={}", encoded_query);

    tracing::info!("🌐 [web_search] Navigating to: {}", search_url);

    // Navigate to search URL
    tab.navigate_to(&search_url)
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

    // Parse search results
    let results = parse_yahoo_results(&html, max_results);
    tracing::info!("✅ [web_search] Found {} results", results.len());

    Ok(results)
}

/// Parse Yahoo HTML search results
fn parse_yahoo_results(html: &str, max_results: usize) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);
    let mut results = Vec::new();

    // Yahoo uses different structures - try multiple selectors
    let selectors_to_try = [
        "div.algo-sr",
        "div.dd.algo",
        "li.ov-a",
        "div.Sr",
        "div[data-uuid]",
        "div.algo",
        "li.reg.searchCenterMiddle",
    ];

    for selector_str in selectors_to_try {
        let result_selector = match Selector::parse(selector_str) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let count = document.select(&result_selector).count();
        tracing::info!(
            "🔍 [yahoo] Selector '{}' matched {} elements",
            selector_str,
            count
        );

        if count == 0 {
            continue;
        }

        let title_selector = Selector::parse("h3 a, a.ac-algo, h3.title a, a[href]").unwrap();
        let snippet_selector = Selector::parse("p, div.compText, span.fc-falcon").unwrap();

        for result_el in document.select(&result_selector).take(max_results * 2) {
            // Find a valid link - allow Yahoo redirect URLs
            let title_el = result_el.select(&title_selector).find(|el| {
                el.value()
                    .attr("href")
                    .map(|h| h.starts_with("http") || h.contains("r.search.yahoo"))
                    .unwrap_or(false)
            });

            let (title, url) = match title_el {
                Some(el) => {
                    let title = el.text().collect::<String>().trim().to_string();
                    let href = el.value().attr("href").unwrap_or_default();
                    let url = extract_yahoo_redirect_url(href);
                    (title, url)
                }
                None => continue,
            };

            // Skip invalid URLs
            if url.is_empty() || !url.starts_with("http") {
                continue;
            }

            // Skip Yahoo's own search pages (but not redirect URLs which we've already extracted)
            if url.contains("yahoo.com/search") {
                continue;
            }

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

        if !results.is_empty() {
            break;
        }
    }

    results
}

/// Extract actual URL from Yahoo redirect link
///
/// Yahoo wraps URLs in redirect links like:
/// https://r.search.yahoo.com/_ylt=.../RU=https%3A%2F%2Fexample.com/RK=...
fn extract_yahoo_redirect_url(href: &str) -> String {
    // Check if it's a Yahoo redirect URL
    if href.contains("r.search.yahoo.com") || href.contains("/RU=") {
        // Extract the RU parameter which contains the actual URL
        if let Some(ru_start) = href.find("/RU=") {
            let url_part = &href[ru_start + 4..];
            // Find the end of the URL (either /RK= or end of string)
            let url_end = url_part.find("/RK=").unwrap_or(url_part.len());
            let encoded_url = &url_part[..url_end];
            // Decode the URL
            let decoded: String = form_urlencoded::parse(encoded_url.as_bytes())
                .map(|(k, v)| {
                    if v.is_empty() {
                        k.to_string()
                    } else {
                        format!("{}={}", k, v)
                    }
                })
                .collect::<Vec<_>>()
                .join("");

            if decoded.starts_with("http") {
                return decoded;
            }
        }
    }

    // Return as-is if not a redirect URL
    href.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_yahoo_redirect_url() {
        let href = "https://r.search.yahoo.com/_ylt=abc/RU=https%3A%2F%2Fexample.com%2Fpage/RK=0";
        let result = extract_yahoo_redirect_url(href);
        assert_eq!(result, "https://example.com/page");
    }

    #[test]
    fn test_extract_yahoo_direct_url() {
        let href = "https://example.com/page";
        let result = extract_yahoo_redirect_url(href);
        assert_eq!(result, "https://example.com/page");
    }
}
