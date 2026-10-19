//! Baidu search provider
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

/// Perform Baidu search using headless Chrome
///
/// # Arguments
/// * `query` - The search query string
/// * `max_results` - Maximum number of results to return
///
/// # Returns
/// A `WebSearchResponse` containing the search results
pub async fn search_baidu(query: &str, max_results: usize) -> Result<WebSearchResponse> {
    let searched_at = Utc::now().to_rfc3339();
    let encoded_query: String = form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let search_url = format!("https://www.baidu.com/s?wd={}", encoded_query);

    // Fetch tier chain: HTTP → obscura (if installed) → system WebView
    if let Some(results) = super::utils::scrape_search_results(
        &search_url,
        core_search::parse_baidu_results,
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
            provider: SearchProvider::Baidu,
        });
    }

    // Fall back to headless Chrome (blocking thread since headless_chrome is sync)
    let results =
        tokio::task::spawn_blocking(move || search_baidu_sync(&search_url, max_results)).await??;

    let total_results = results.len();

    Ok(WebSearchResponse {
        query: query.to_string(),
        results,
        total_results,
        searched_at,
        provider: SearchProvider::Baidu,
    })
}

/// Synchronous Baidu search implementation via headless Chrome
fn search_baidu_sync(search_url: &str, max_results: usize) -> Result<Vec<SearchResultItem>> {
    tracing::info!("🔍 [web_search] Starting Baidu search for: {}", search_url);

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

    tracing::info!("🌐 [web_search] Navigating to: {}", search_url);

    // Navigate to search URL
    tab.navigate_to(search_url)
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

    #[test]
    fn test_parse_baidu_extracts_titles_urls_and_snippets() {
        let html = r#"<html><body><div id="content_left">
<div class="result c-container new-pmd" srcid="1599" tpl="se_com_default" mu="https://www.rust-lang.org/">
    <h3 class="t">
        <a href="http://www.baidu.com/link?url=8aGf3Ks9eFq2NvV0bWdL0eKf" target="_blank">
            <em>Rust</em> Programming Language
        </a>
    </h3>
    <div class="c-abstract">A language empowering everyone <span class="content-right_8Zs40">- rust-lang.org</span></div>
</div>
<div class="c-container" tpl="se_st_3">
    <h3 class="c-title t">
        <a href="http://www.baidu.com/link?url=qY7dPmWnRtSxKz3EeCvB5uJj">Cargo: the Rust package manager</a>
    </h3>
    <span class="content-right_8Zs40">Cargo downloads your Rust project dependencies</span>
</div>
<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=std_docs">Rust standard library docs</a></h3>
    <div class="c-row"><div class="c-span-last">Everything about the standard library</div></div>
</div>
</div></body></html>"#;

        let results = core_search::parse_baidu_results(html, 10);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "Rust Programming Language");
        assert_eq!(
            results[0].url,
            "http://www.baidu.com/link?url=8aGf3Ks9eFq2NvV0bWdL0eKf"
        );
        assert_eq!(
            results[0].snippet,
            "A language empowering everyone - rust-lang.org"
        );
        assert_eq!(results[1].title, "Cargo: the Rust package manager");
        assert_eq!(
            results[1].url,
            "http://www.baidu.com/link?url=qY7dPmWnRtSxKz3EeCvB5uJj"
        );
        assert_eq!(
            results[1].snippet,
            "Cargo downloads your Rust project dependencies"
        );
        assert_eq!(results[2].title, "Rust standard library docs");
        assert_eq!(results[2].url, "http://www.baidu.com/link?url=std_docs");
        assert_eq!(results[2].snippet, "Everything about the standard library");
    }

    #[test]
    fn test_parse_baidu_cjk_results() {
        let html = r#"<html><body><div id="content_left">
<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=zh_example">Rust 官方网站 - Rust 编程语言</a></h3>
    <div class="c-abstract">Rust 是一门着眼于安全性、并发性与高性能的系统编程语言。</div>
</div>
<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=ja_example">Rust 公式サイト - Rust プログラミング言語</a></h3>
    <div class="c-abstract">Rust は高速でメモリ安全なシステムプログラミング言語です。</div>
</div>
<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=ko_example">Rust 공식 사이트 - Rust 프로그래밍 언어</a></h3>
    <div class="c-abstract">Rust는 빠르고 메모리 안전한 시스템 프로그래밍 언어입니다.</div>
</div>
</div></body></html>"#;

        let results = core_search::parse_baidu_results(html, 10);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "Rust 官方网站 - Rust 编程语言");
        assert_eq!(results[0].url, "http://www.baidu.com/link?url=zh_example");
        assert_eq!(
            results[0].snippet,
            "Rust 是一门着眼于安全性、并发性与高性能的系统编程语言。"
        );
        assert_eq!(
            results[1].title,
            "Rust 公式サイト - Rust プログラミング言語"
        );
        assert_eq!(results[1].url, "http://www.baidu.com/link?url=ja_example");
        assert_eq!(
            results[1].snippet,
            "Rust は高速でメモリ安全なシステムプログラミング言語です。"
        );
        assert_eq!(results[2].title, "Rust 공식 사이트 - Rust 프로그래밍 언어");
        assert_eq!(results[2].url, "http://www.baidu.com/link?url=ko_example");
        assert_eq!(
            results[2].snippet,
            "Rust는 빠르고 메모리 안전한 시스템 프로그래밍 언어입니다."
        );
    }

    #[test]
    fn test_parse_baidu_skips_results_with_missing_fields() {
        let html = r#"<html><body><div id="content_left">
<div class="result c-container">
    <h3 class="t"><a target="_blank">Anchor without href</a></h3>
    <div class="c-abstract">Dropped because the href is missing.</div>
</div>
<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=blank_title"></a></h3>
    <div class="c-abstract">Dropped because the title text is empty.</div>
</div>
<div class="result c-container">
    <div class="c-abstract">Dropped because there is no heading at all.</div>
</div>
<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=no_snippet">Kept without a snippet</a></h3>
</div>
</div></body></html>"#;

        let results = core_search::parse_baidu_results(html, 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Kept without a snippet");
        assert_eq!(results[0].url, "http://www.baidu.com/link?url=no_snippet");
        assert_eq!(results[0].snippet, "");
    }

    #[test]
    fn test_parse_baidu_skips_promoted_and_baidu_property_blocks() {
        let html = r#"<html><body><div id="content_left">
<div class="result c-container" tpl="asp">
    <h3 class="t"><a href="https://www.baidu.com/sf?pd=web_ese&amp;word=rust">Sponsored - Rust course discount</a></h3>
    <div class="c-abstract">Promoted placement served through baidu.com/sf.</div>
</div>
<div class="result c-container">
    <h3 class="t"><a href="https://baike.baidu.com/item/rust">Rust - Baidu Baike</a></h3>
    <div class="c-abstract">Encyclopedia card, filtered out.</div>
</div>
<div class="result c-container">
    <h3 class="t"><a href="https://tieba.baidu.com/f?kw=rust">Rust Tieba forum</a></h3>
    <div class="c-abstract">Forum card, filtered out.</div>
</div>
<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=organic_hit">The Rust Programming Language book</a></h3>
    <div class="c-abstract">An introduction to Rust by its developers.</div>
</div>
</div></body></html>"#;

        let results = core_search::parse_baidu_results(html, 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "The Rust Programming Language book");
        assert_eq!(results[0].url, "http://www.baidu.com/link?url=organic_hit");
        assert_eq!(
            results[0].snippet,
            "An introduction to Rust by its developers."
        );
    }

    #[test]
    fn test_parse_baidu_no_results_page() {
        let html = r#"<html><body>
<div class="nors">
    <p>Sorry, no results were found for <b>"qwzxvjkwer"</b></p>
    <p class="norsTip">Suggestions: check spelling or try different keywords.</p>
</div>
<div id="page"><strong>1</strong><a href="/s?wd=qwzxvjkwer&amp;pn=10">Next page</a></div>
</body></html>"#;

        assert!(core_search::parse_baidu_results(html, 10).is_empty());
    }

    #[test]
    fn test_parse_baidu_respects_max_results() {
        let html = r#"<html><body><div id="content_left">
<div class="result c-container"><h3 class="t"><a href="http://www.baidu.com/link?url=hit_1">First hit</a></h3><div class="c-abstract">One</div></div>
<div class="result c-container"><h3 class="t"><a href="http://www.baidu.com/link?url=hit_2">Second hit</a></h3><div class="c-abstract">Two</div></div>
<div class="result c-container"><h3 class="t"><a href="http://www.baidu.com/link?url=hit_3">Third hit</a></h3><div class="c-abstract">Three</div></div>
</div>
<div id="page"><a href="/s?wd=rust&amp;pn=10">2</a></div>
</body></html>"#;

        let limited = core_search::parse_baidu_results(html, 2);
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].title, "First hit");
        assert_eq!(limited[1].title, "Second hit");

        let all = core_search::parse_baidu_results(html, 10);
        assert_eq!(all.len(), 3);
        assert_eq!(all[2].title, "Third hit");
    }

    #[test]
    fn test_parse_baidu_zero_max_returns_nothing() {
        let html = r#"<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=hit_1">First hit</a></h3>
    <div class="c-abstract">One</div>
</div>"#;
        assert!(core_search::parse_baidu_results(html, 0).is_empty());
    }

    #[test]
    fn test_parse_baidu_decodes_html_entities() {
        let html = r#"<html><body><div id="content_left">
<div class="result c-container">
    <h3 class="t"><a href="http://www.baidu.com/link?url=entities">Rust &amp; Cargo &#8212; the definitive guide</a></h3>
    <div class="c-abstract">&quot;memory&nbsp;safety&quot; &amp; &#39;ownership&#39; in Rust&lt;/&gt;</div>
</div>
</div></body></html>"#;

        let results = core_search::parse_baidu_results(html, 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Rust & Cargo — the definitive guide");
        assert_eq!(
            results[0].snippet,
            "\"memory\u{00A0}safety\" & 'ownership' in Rust</>"
        );
    }
}
