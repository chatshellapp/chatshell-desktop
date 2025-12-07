//! DuckDuckGo search provider
//!
//! Implements web search using headless Chrome with stealth mode
//! to bypass bot detection.

use anyhow::Result;
use chrono::Utc;
use scraper::{Html, Selector};
use std::time::Duration;
use url::form_urlencoded;

use crate::web_fetch::{create_new_browser, STEALTH_JS};

use super::types::{DuckDuckGoSearchResponse, SearchResultItem};

/// Perform DuckDuckGo search using headless Chrome
///
/// # Arguments
/// * `query` - The search query string
/// * `max_results` - Maximum number of results to return
///
/// # Returns
/// A `DuckDuckGoSearchResponse` containing the search results
pub async fn search_duckduckgo(
    query: &str,
    max_results: usize,
) -> Result<DuckDuckGoSearchResponse> {
    let query_owned = query.to_string();
    let searched_at = Utc::now().to_rfc3339();

    // Run in blocking thread since headless_chrome is sync
    let results =
        tokio::task::spawn_blocking(move || search_duckduckgo_sync(&query_owned, max_results))
            .await??;

    let total_results = results.len();

    Ok(DuckDuckGoSearchResponse {
        query: query.to_string(),
        results,
        total_results,
        searched_at,
    })
}

/// Synchronous DuckDuckGo search implementation
fn search_duckduckgo_sync(query: &str, max_results: usize) -> Result<Vec<SearchResultItem>> {
    println!("🔍 [web_search] Starting DuckDuckGo search for: {}", query);

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
    tab.evaluate(&*STEALTH_JS, false)
        .map_err(|e| anyhow::anyhow!("Failed to inject stealth JS: {}", e))?;

    println!("🛡️ [web_search] Stealth mode enabled, navigating to DuckDuckGo...");

    // Build search URL - use HTML version which is easier to parse
    let encoded_query: String = form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let search_url = format!("https://duckduckgo.com/html/?q={}", encoded_query);

    println!("🌐 [web_search] Navigating to: {}", search_url);

    // Navigate to search URL
    tab.navigate_to(&search_url)
        .map_err(|e| anyhow::anyhow!("Failed to navigate: {}", e))?;

    // Wait for navigation to complete
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Navigation timeout: {}", e))?;

    // Wait for results to load
    println!("⏳ [web_search] Waiting for search results to load...");
    std::thread::sleep(Duration::from_secs(3));

    let html = tab
        .get_content()
        .map_err(|e| anyhow::anyhow!("Failed to get page content: {}", e))?;

    println!("📄 [web_search] Got {} bytes of HTML", html.len());

    // Parse search results
    let results = parse_duckduckgo_results(&html, max_results);
    println!("✅ [web_search] Found {} results", results.len());

    Ok(results)
}

/// Parse DuckDuckGo HTML search results
fn parse_duckduckgo_results(html: &str, max_results: usize) -> Vec<SearchResultItem> {
    let document = Html::parse_document(html);
    let mut results = Vec::new();

    // DuckDuckGo HTML version uses .result class for each result
    // The structure is:
    // <div class="result">
    //   <a class="result__a" href="...">Title</a>
    //   <a class="result__snippet">Snippet text...</a>
    // </div>

    let result_selector = Selector::parse(".result").unwrap();
    let title_selector = Selector::parse(".result__a").unwrap();
    let snippet_selector = Selector::parse(".result__snippet").unwrap();

    for result_el in document.select(&result_selector).take(max_results) {
        // Extract title and URL
        let (title, url) = match result_el.select(&title_selector).next() {
            Some(el) => {
                let title = el.text().collect::<String>().trim().to_string();
                let href = el.value().attr("href").unwrap_or_default();
                let url = extract_actual_url(href);
                (title, url)
            }
            None => continue,
        };

        // Extract snippet
        let snippet = result_el
            .select(&snippet_selector)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        // Only include results with valid URL
        if !title.is_empty() && !url.is_empty() && url.starts_with("http") {
            results.push(SearchResultItem {
                title,
                url,
                snippet,
            });
        }
    }

    results
}

/// Extract actual URL from DuckDuckGo redirect link
///
/// DuckDuckGo wraps URLs in redirect links like:
/// //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
fn extract_actual_url(href: &str) -> String {
    // Handle DuckDuckGo redirect URLs
    if href.contains("duckduckgo.com/l/") || href.contains("uddg=") {
        // Extract the uddg parameter which contains the actual URL
        if let Some(uddg_start) = href.find("uddg=") {
            let url_part = &href[uddg_start + 5..];
            // Find the end of the URL (either & or end of string)
            let url_end = url_part.find('&').unwrap_or(url_part.len());
            let encoded_url = &url_part[..url_end];
            // Decode the URL using form_urlencoded
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
            // If the decoded string is empty or different, try percent decoding directly
            if decoded.is_empty() || !decoded.starts_with("http") {
                // Try direct percent decode
                if let Ok(decoded) = url::Url::parse(&format!("http://x?x={}", encoded_url)) {
                    if let Some(value) = decoded
                        .query_pairs()
                        .find(|(k, _)| k == "x")
                        .map(|(_, v)| v.to_string())
                    {
                        if value.starts_with("http") {
                            return value;
                        }
                    }
                }
                // Fallback: manual percent decode
                let decoded = percent_decode_str(encoded_url);
                if decoded.starts_with("http") {
                    return decoded;
                }
            }
            if decoded.starts_with("http") {
                return decoded;
            }
        }
    }

    // Handle protocol-relative URLs
    if href.starts_with("//") {
        return format!("https:{}", href);
    }

    href.to_string()
}

/// Simple percent decoding for URL strings
fn percent_decode_str(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2 {
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    result.push(byte as char);
                    continue;
                }
            }
            result.push('%');
            result.push_str(&hex);
        } else {
            result.push(c);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_actual_url_redirect() {
        let href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc";
        let result = extract_actual_url(href);
        assert_eq!(result, "https://example.com/page");
    }

    #[test]
    fn test_extract_actual_url_protocol_relative() {
        let href = "//example.com/page";
        let result = extract_actual_url(href);
        assert_eq!(result, "https://example.com/page");
    }

    #[test]
    fn test_extract_actual_url_direct() {
        let href = "https://example.com/page";
        let result = extract_actual_url(href);
        assert_eq!(result, "https://example.com/page");
    }
}

