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

    #[test]
    fn test_resolve_yahoo_redirect_url_without_rk_terminator() {
        let href = "https://r.search.yahoo.com/_ylt=abc/RU=https%3A%2F%2Fexample.com%2Ftrailing";
        let result = core_search::resolve_yahoo_redirect_url(href);
        assert_eq!(result, "https://example.com/trailing");
    }

    #[test]
    fn test_resolve_yahoo_redirect_url_lowercase_hex_digits() {
        let href = "https://r.search.yahoo.com/_ylt=abc/RU=https%3a%2f%2fexample.com%2fpath/RK=0";
        let result = core_search::resolve_yahoo_redirect_url(href);
        assert_eq!(result, "https://example.com/path");
    }

    #[test]
    fn test_resolve_yahoo_redirect_url_non_http_scheme_falls_back() {
        // The decoded target is not an http(s) URL, so the wrapper is returned as-is.
        let href =
            "https://r.search.yahoo.com/_ylt=abc/RU=ftp%3A%2F%2Ffiles.example.com%2Fpub/RK=2";
        let result = core_search::resolve_yahoo_redirect_url(href);
        assert_eq!(result, href);
    }

    #[test]
    fn test_resolve_yahoo_redirect_url_without_ru_parameter() {
        let href = "https://r.search.yahoo.com/_ylt=abc/RV=abc123";
        let result = core_search::resolve_yahoo_redirect_url(href);
        assert_eq!(result, href);
    }

    #[test]
    fn test_resolve_yahoo_redirect_url_invalid_utf8_target_falls_back() {
        // %FF%FE decodes to bytes that are not valid UTF-8, so decoding fails.
        let href = "https://r.search.yahoo.com/_ylt=abc/RU=%FF%FE/RK=2";
        let result = core_search::resolve_yahoo_redirect_url(href);
        assert_eq!(result, href);
    }

    #[test]
    fn test_parse_yahoo_empty_html() {
        let results = core_search::parse_yahoo_results("<html></html>", 5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_parse_yahoo_algo_sr_layout() {
        let html = r#"<html><body><div id="web"><ol>
<li>
<div class="algo-sr" data-uuid="7f3a2b91">
    <div class="compTitle">
        <h3 class="title">
            <a href="https://r.search.yahoo.com/_ylt=Avx1/RU=https%3A%2F%2Fwww.rust-lang.org%2F/RK=2/RO=Rust"
               class=" ac-algo" referrerpolicy="unsafe-url">Rust Programming Language</a>
        </h3>
    </div>
    <div class="compText"><p class="fz-ms">A language empowering everyone to build reliable software.</p></div>
</div>
</li>
<li>
<div class="algo-sr" data-uuid="9b1c4e07">
    <div class="compTitle">
        <h3 class="title"><a href="https://example.org/rust-docs" class=" ac-algo">Rust Documentation</a></h3>
    </div>
    <div class="compText"><p>Learn Rust with the full book, examples, and tools.</p></div>
</div>
</li>
</ol></div></body></html>"#;

        let results = core_search::parse_yahoo_results(html, 10);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Rust Programming Language");
        assert_eq!(results[0].url, "https://www.rust-lang.org/");
        assert_eq!(
            results[0].snippet,
            "A language empowering everyone to build reliable software."
        );
        assert_eq!(results[1].title, "Rust Documentation");
        assert_eq!(results[1].url, "https://example.org/rust-docs");
        assert_eq!(
            results[1].snippet,
            "Learn Rust with the full book, examples, and tools."
        );
    }

    #[test]
    fn test_parse_yahoo_dd_algo_layout() {
        let html = r#"<html><body><div id="web"><ol>
<li>
<div class="dd algo">
    <h3><a class=" ac-algo" href="https://r.search.yahoo.com/_ylt=b2/RU=https%3A%2F%2Fdoc.rust-lang.org%2Fcargo%2F/RK=0">Cargo, the Rust package manager</a></h3>
    <div class="compText"><p>Cargo is the Rust package manager. Cargo downloads your dependencies.</p></div>
</div>
</li>
</ol></div></body></html>"#;

        let results = core_search::parse_yahoo_results(html, 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Cargo, the Rust package manager");
        assert_eq!(results[0].url, "https://doc.rust-lang.org/cargo/");
        assert_eq!(
            results[0].snippet,
            "Cargo is the Rust package manager. Cargo downloads your dependencies."
        );
    }

    #[test]
    fn test_parse_yahoo_resolves_cjk_redirect_targets() {
        let html = r#"<html><body><div id="web">
<div class="algo">
    <h3><a class=" ac-algo" href="https://r.search.yahoo.com/_ylt=zh/RU=https%3A%2F%2Fzh.wikipedia.org%2Fwiki%2FRust%EF%BC%88%E7%BC%96%E7%A8%8B%E8%AF%AD%E8%A8%80%EF%BC%89/RK=2">Rust（编程语言） - 维基百科</a></h3>
    <div class="compText"><p>Rust 是一门系统级编程语言。</p></div>
</div>
<div class="algo">
    <h3><a class=" ac-algo" href="https://r.search.yahoo.com/_ylt=ja/RU=https%3A%2F%2Fja.wikipedia.org%2Fwiki%2FRust%EF%BC%88%E3%83%97%E3%83%AD%E3%82%B0%E3%83%A9%E3%83%9F%E3%83%B3%E3%82%B0%E8%A8%80%E8%AA%9E%EF%BC%89/RK=2">Rust（プログラミング言語） - Wikipedia</a></h3>
    <div class="compText"><p>Rust はシステムプログラミング言語です。</p></div>
</div>
<div class="algo">
    <h3><a class=" ac-algo" href="https://r.search.yahoo.com/_ylt=ko/RU=https%3A%2F%2Fko.wikipedia.org%2Fwiki%2FRust%28%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%98%EB%B0%8D_%EC%96%B8%EC%96%B4%29/RK=2">Rust(프로그래밍 언어) - 위키백과</a></h3>
    <div class="compText"><p>Rust는 시스템 프로그래밍 언어입니다.</p></div>
</div>
</div></body></html>"#;

        let results = core_search::parse_yahoo_results(html, 10);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "Rust（编程语言） - 维基百科");
        assert_eq!(
            results[0].url,
            "https://zh.wikipedia.org/wiki/Rust（编程语言）"
        );
        assert_eq!(results[0].snippet, "Rust 是一门系统级编程语言。");
        assert_eq!(results[1].title, "Rust（プログラミング言語） - Wikipedia");
        assert_eq!(
            results[1].url,
            "https://ja.wikipedia.org/wiki/Rust（プログラミング言語）"
        );
        assert_eq!(
            results[1].snippet,
            "Rust はシステムプログラミング言語です。"
        );
        assert_eq!(results[2].title, "Rust(프로그래밍 언어) - 위키백과");
        assert_eq!(
            results[2].url,
            "https://ko.wikipedia.org/wiki/Rust(프로그래밍_언어)"
        );
        assert_eq!(results[2].snippet, "Rust는 시스템 프로그래밍 언어입니다.");
    }

    #[test]
    fn test_parse_yahoo_skips_results_with_missing_fields() {
        let html = r#"<html><body><div id="web">
<div class="algo">
    <h3><a href="/sports/golf">Relative link only</a></h3>
    <div class="compText"><p>No absolute href, so the container is skipped.</p></div>
</div>
<div class="algo">
    <h3><a href="ftp://files.example.com/rust">Non-http scheme</a></h3>
    <div class="compText"><p>The link never qualifies as a title element.</p></div>
</div>
<div class="algo">
    <h3><a href="https://example.com/blank">   </a></h3>
    <div class="compText"><p>Whitespace-only title, skipped.</p></div>
</div>
<div class="algo">
    <h3><a href="https://example.com/no-snippet">Result without a snippet</a></h3>
</div>
</div></body></html>"#;

        let results = core_search::parse_yahoo_results(html, 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Result without a snippet");
        assert_eq!(results[0].url, "https://example.com/no-snippet");
        assert_eq!(results[0].snippet, "");
    }

    #[test]
    fn test_parse_yahoo_skips_internal_search_links() {
        let html = r#"<html><body><div id="web">
<div class="algo">
    <h3><a href="https://r.search.yahoo.com/_ylt=i/RU=https%3A%2F%2Fsearch.yahoo.com%2Fsearch%3Fp%3Drust%26fr%3Dyfp-t/RK=2">More results for rust</a></h3>
    <div class="compText"><p>Points back at Yahoo search itself, filtered out.</p></div>
</div>
<div class="algo">
    <h3><a href="https://r.search.yahoo.com/_ylt=j/RU=https%3A%2F%2Fwww.rust-lang.org%2Flearn/RK=2">Learn Rust - rust-lang.org</a></h3>
    <div class="compText"><p>External learning hub, kept as a result.</p></div>
</div>
</div></body></html>"#;

        let results = core_search::parse_yahoo_results(html, 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Learn Rust - rust-lang.org");
        assert_eq!(results[0].url, "https://www.rust-lang.org/learn");
        assert_eq!(
            results[0].snippet,
            "External learning hub, kept as a result."
        );
    }

    #[test]
    fn test_parse_yahoo_handles_sponsored_blocks() {
        // Sponsored placements resolve to ordinary external http targets, so the
        // shared parser extracts them exactly like organic hits.
        let html = r#"<html><body><div id="web">
<div class="algo">
    <div class="compTitle">
        <h3><a class=" ac-algo" href="https://r.search.yahoo.com/_ylt=s/RU=https%3A%2F%2Fadvertiser.example%2Fpromo%3Futm_source%3Dyahoo/RK=2">Sponsored - Rust course deal</a></h3>
    </div>
    <div class="compText"><p>Marketed placement extracted like an organic result.</p></div>
</div>
</div></body></html>"#;

        let results = core_search::parse_yahoo_results(html, 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Sponsored - Rust course deal");
        assert_eq!(
            results[0].url,
            "https://advertiser.example/promo?utm_source=yahoo"
        );
        assert_eq!(
            results[0].snippet,
            "Marketed placement extracted like an organic result."
        );
    }

    #[test]
    fn test_parse_yahoo_no_results_page() {
        let html = r#"<html><body><div id="web">
<div class="compNoResults">
    <h3>No results found for "qwzxvjkwer"</h3>
    <p>Check your spelling or try more general keywords.</p>
</div>
<div class="compPagination"><a href="https://search.yahoo.com/search?p=qwzxvjkwer&amp;b=1">1</a></div>
</div></body></html>"#;

        assert!(core_search::parse_yahoo_results(html, 10).is_empty());
    }

    #[test]
    fn test_parse_yahoo_respects_max_results() {
        let html = r#"<html><body><div id="web">
<div class="algo"><h3><a href="https://example.com/one">First hit</a></h3><p>One</p></div>
<div class="algo"><h3><a href="https://example.com/two">Second hit</a></h3><p>Two</p></div>
<div class="algo"><h3><a href="https://example.com/three">Third hit</a></h3><p>Three</p></div>
<div class="compPagination"><a href="https://search.yahoo.com/search?p=x&amp;b=8">2</a></div>
</div></body></html>"#;

        let limited = core_search::parse_yahoo_results(html, 2);
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].title, "First hit");
        assert_eq!(limited[0].snippet, "One");
        assert_eq!(limited[1].title, "Second hit");

        let all = core_search::parse_yahoo_results(html, 10);
        assert_eq!(all.len(), 3);
        assert_eq!(all[2].title, "Third hit");
    }

    #[test]
    fn test_parse_yahoo_zero_max_returns_nothing() {
        let html = r#"<div class="algo"><h3><a href="https://example.com/one">First hit</a></h3><p>One</p></div>"#;
        assert!(core_search::parse_yahoo_results(html, 0).is_empty());
    }
}
