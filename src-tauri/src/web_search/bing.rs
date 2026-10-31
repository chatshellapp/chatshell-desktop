//! Bing search provider
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

/// Perform Bing search
///
/// # Arguments
/// * `query` - The search query string
/// * `max_results` - Maximum number of results to return
///
/// # Returns
/// A `WebSearchResponse` containing the search results
///
/// The query deliberately omits `mkt`/`cc` params: they make Bing return
/// unrelated results (see SearXNG's Bing traits); `setlang=en` keeps the
/// page language stable like the shared HTTP tier's Accept-Language.
pub async fn search_bing(query: &str, max_results: usize) -> Result<WebSearchResponse> {
    let searched_at = Utc::now().to_rfc3339();
    let encoded_query: String = form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let search_url = format!(
        "https://www.bing.com/search?q={}&adlt=moderate&setlang=en",
        encoded_query
    );

    // Fetch tier chain: HTTP → obscura (if installed) → system WebView
    if let Some(results) = super::utils::scrape_search_results(
        &search_url,
        core_search::parse_bing_results,
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
            provider: SearchProvider::Bing,
        });
    }

    // Fall back to headless Chrome (blocking thread since headless_chrome is sync)
    let results =
        tokio::task::spawn_blocking(move || search_bing_sync(&search_url, max_results)).await??;

    let total_results = results.len();

    Ok(WebSearchResponse {
        query: query.to_string(),
        results,
        total_results,
        searched_at,
        provider: SearchProvider::Bing,
    })
}

/// Synchronous Bing search implementation via headless Chrome
fn search_bing_sync(search_url: &str, max_results: usize) -> Result<Vec<SearchResultItem>> {
    tracing::info!("🔍 [web_search] Starting Bing search for: {}", search_url);

    let browser = create_new_browser()?;

    let tab = browser
        .new_tab()
        .map_err(|e| anyhow::anyhow!("Failed to create tab: {}", e))?;

    // Set realistic User-Agent before navigation
    tab.set_user_agent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Some("en-US,en;q=0.9"),
        Some("macOS"),
    )
    .map_err(|e| anyhow::anyhow!("Failed to set user agent: {}", e))?;

    // Navigate to blank page first to inject stealth JS
    tab.navigate_to("about:blank")
        .map_err(|e| anyhow::anyhow!("Failed to navigate to blank: {}", e))?;
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Blank navigation timeout: {}", e))?;

    // Inject stealth JavaScript to hide headless detection
    tab.evaluate(&STEALTH_JS, false)
        .map_err(|e| anyhow::anyhow!("Failed to inject stealth JS: {}", e))?;

    tracing::info!("🛡️ [web_search] Stealth mode enabled, navigating to Bing...");

    tracing::info!("🌐 [web_search] Navigating to: {}", search_url);

    // Navigate to search URL
    tab.navigate_to(search_url)
        .map_err(|e| anyhow::anyhow!("Failed to navigate: {}", e))?;

    // Wait for navigation to complete
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Navigation timeout: {}", e))?;

    // Wait for results to load
    tracing::info!("⏳ [web_search] Waiting for search results to load...");
    std::thread::sleep(Duration::from_secs(4));

    let html = tab
        .get_content()
        .map_err(|e| anyhow::anyhow!("Failed to get page content: {}", e))?;

    tracing::info!("📄 [web_search] Got {} bytes of HTML", html.len());

    // Parse via the shared core parser (single home for extraction semantics)
    let results: Vec<SearchResultItem> = core_search::parse_bing_results(&html, max_results)
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
        let results = core_search::parse_bing_results("<html></html>", 5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_parse_bing_extracts_titles_urls_and_snippets() {
        let html = r#"<html><body><ol id="b_results">
<li class="b_algo">
    <h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1aHR0cHM6Ly93d3cucnVzdC1sYW5nLm9yZy9sZWFybg&amp;ntb=1">Learn Rust</a></h2>
    <p class="b_lineclamp2 b_algoSlug"><span class="algoSlug_icon">Web</span><svg></svg>Learn Rust with example projects.</p>
</li>
<li class="b_algo">
    <h2><a href="https://doc.rust-lang.org/cargo/">Cargo Book</a></h2>
    <div class="b_caption"><p>Cargo is the Rust package manager.</p></div>
</li>
<li class="b_algo">
    <h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=y&amp;u=a1aHR0cHM6Ly9naXRodWIuY29tL3J1c3QvbGVhcm4&amp;ntb=1">GitHub repository</a></h2>
    <p>Community-driven tutorials and translations.</p>
</li>
</ol></body></html>"#;

        let results = core_search::parse_bing_results(html, 10);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "Learn Rust");
        assert_eq!(results[0].url, "https://www.rust-lang.org/learn");
        assert_eq!(results[0].snippet, "Learn Rust with example projects.");
        assert_eq!(results[1].title, "Cargo Book");
        assert_eq!(results[1].url, "https://doc.rust-lang.org/cargo/");
        assert_eq!(results[1].snippet, "Cargo is the Rust package manager.");
        assert_eq!(results[2].title, "GitHub repository");
        assert_eq!(results[2].url, "https://github.com/rust/learn");
        assert_eq!(
            results[2].snippet,
            "Community-driven tutorials and translations."
        );
    }

    #[test]
    fn test_parse_bing_multilingual_results() {
        let html = r#"<html><body><ol id="b_results">
<li class="b_algo"><h2><a href="https://zh.example.com/rust">Rust 官方网站 - Rust 编程语言</a></h2><p>Rust 是一门着眼于安全性与高性能的系统编程语言。</p></li>
<li class="b_algo"><h2><a href="https://ja.example.com/rust">Rust 公式サイト - Rust プログラミング言語</a></h2><p>Rust は高速でメモリ安全なシステムプログラミング言語です。</p></li>
<li class="b_algo"><h2><a href="https://ko.example.com/rust">Rust 공식 사이트 - Rust 프로그래밍 언어</a></h2><p>Rust는 빠르고 메모리 안전한 시스템 프로그래밍 언어입니다.</p></li>
</ol></body></html>"#;

        let results = core_search::parse_bing_results(html, 10);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "Rust 官方网站 - Rust 编程语言");
        assert_eq!(
            results[1].title,
            "Rust 公式サイト - Rust プログラミング言語"
        );
        assert_eq!(results[2].title, "Rust 공식 사이트 - Rust 프로그래밍 언어");
    }
}
