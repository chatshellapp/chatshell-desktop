//! DuckDuckGo search provider
//!
//! Scrapes result pages through the Obscura browser tier when configured,
//! falling back to headless Chrome with stealth mode to bypass bot detection.

use anyhow::Result;
use chrono::Utc;
use std::time::Duration;
use url::form_urlencoded;

use chatshell_agent_core::web_search as core_search;

use crate::web_fetch::{STEALTH_JS, create_new_browser};

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
    let searched_at = Utc::now().to_rfc3339();
    let encoded_query: String = form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let search_url = format!("https://duckduckgo.com/html/?q={}", encoded_query);

    // Fetch tier chain: HTTP → obscura (if installed) → system WebView
    if let Some(results) = super::utils::scrape_search_results(
        &search_url,
        core_search::parse_duckduckgo_results,
        max_results,
    )
    .await
    {
        let total_results = results.len();
        return Ok(DuckDuckGoSearchResponse {
            query: query.to_string(),
            results,
            total_results,
            searched_at,
        });
    }

    // Fall back to headless Chrome (blocking thread since headless_chrome is sync)
    let results =
        tokio::task::spawn_blocking(move || search_duckduckgo_sync(&search_url, max_results))
            .await??;

    let total_results = results.len();

    Ok(DuckDuckGoSearchResponse {
        query: query.to_string(),
        results,
        total_results,
        searched_at,
    })
}

/// Synchronous DuckDuckGo search implementation via headless Chrome
fn search_duckduckgo_sync(search_url: &str, max_results: usize) -> Result<Vec<SearchResultItem>> {
    tracing::info!(
        "🔍 [web_search] Starting DuckDuckGo search for: {}",
        search_url
    );

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

    tracing::info!("🛡️ [web_search] Stealth mode enabled, navigating to DuckDuckGo...");

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
    let results: Vec<SearchResultItem> = core_search::parse_duckduckgo_results(&html, max_results)
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
    fn test_extract_actual_url_redirect() {
        let href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "https://example.com/page");
    }

    #[test]
    fn test_extract_actual_url_protocol_relative() {
        let href = "//example.com/page";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "https://example.com/page");
    }

    #[test]
    fn test_extract_actual_url_direct() {
        let href = "https://example.com/page";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "https://example.com/page");
    }

    // ---- parse_duckduckgo_results over realistic HTML fixtures ----

    #[test]
    fn test_parse_results_extracts_titles_urls_and_snippets() {
        let html = r#"
<!DOCTYPE html>
<html lang="en">
<head><title>rust language at DuckDuckGo</title></head>
<body>
<div class="results">
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a"
           href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2Flearn%3Fedition%3D2024&amp;rut=abc123">
          <span>The Rust</span> Programming Language - Learn Rust
        </a>
      </h2>
      <a class="result__snippet"
         href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2Flearn&amp;rut=abc123">
        Empower everyone to build reliable and efficient software.
      </a>
      <div class="result__extras">
        <a class="result__url" href="https://duckduckgo.com">rust-lang.org</a>
      </div>
    </div>
  </div>
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a"
           href="https://doc.rust-lang.org/book/title-page.html">
          The Rust Programming Language - The Rust Book
        </a>
      </h2>
      <a class="result__snippet" href="https://doc.rust-lang.org/book/title-page.html">
        This book fully documents the Rust programming language.
      </a>
    </div>
  </div>
</div>
</body>
</html>
"#;
        let results = core_search::parse_duckduckgo_results(html, 10);
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].title,
            "The Rust Programming Language - Learn Rust"
        );
        assert_eq!(
            results[0].url,
            "https://www.rust-lang.org/learn?edition=2024"
        );
        assert_eq!(
            results[0].snippet,
            "Empower everyone to build reliable and efficient software."
        );
        assert_eq!(
            results[1].title,
            "The Rust Programming Language - The Rust Book"
        );
        assert_eq!(
            results[1].url,
            "https://doc.rust-lang.org/book/title-page.html"
        );
        assert_eq!(
            results[1].snippet,
            "This book fully documents the Rust programming language."
        );
    }

    #[test]
    fn test_parse_results_keeps_result_with_missing_snippet() {
        let html = r#"
<div class="result">
    <a class="result__a" href="https://example.com/no-snippet">No Snippet Here</a>
</div>
"#;
        let results = core_search::parse_duckduckgo_results(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "No Snippet Here");
        assert_eq!(results[0].url, "https://example.com/no-snippet");
        assert_eq!(results[0].snippet, "");
    }

    #[test]
    fn test_parse_results_drops_result_without_href() {
        let html = r#"
<div class="result">
    <a class="result__a">Link With No URL Attribute</a>
    <a class="result__snippet">Snippet cannot save it</a>
</div>
"#;
        assert!(core_search::parse_duckduckgo_results(html, 5).is_empty());
    }

    #[test]
    fn test_parse_results_filters_internal_links_keeps_protocol_relative() {
        let html = r#"
<div class="result">
    <a class="result__a" href="/html/?q=internal">Internal Query Link</a>
</div>
<div class="result">
    <a class="result__a" href="//example.org/privacy">Protocol Relative</a>
</div>
"#;
        let results = core_search::parse_duckduckgo_results(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Protocol Relative");
        assert_eq!(results[0].url, "https://example.org/privacy");
    }

    #[test]
    fn test_parse_results_drops_empty_title_and_missing_title_link() {
        let html = r#"
<div class="result">
    <a class="result__a" href="https://example.com/blank-title">
    </a>
</div>
<div class="result">
    <a class="result__snippet">Snippet but no title link</a>
</div>
"#;
        assert!(core_search::parse_duckduckgo_results(html, 5).is_empty());
    }

    #[test]
    fn test_parse_results_keeps_ad_block_with_decoded_ad_target() {
        // Sponsored block as the html endpoint renders it: a y.js ad redirect
        // wrapping the landing page in uddg=. The parser has no ad filter, so
        // it flows through like an organic result with the target decoded.
        let html = r#"
<div class="result result--ad">
    <div class="links_main links_deep result__body">
        <h2 class="result__title">
            <a class="result__a"
               href="//duckduckgo.com/y.js?ad_domain=widgets.example&amp;ad_provider=bing&amp;uddg=https%3A%2F%2Fshop.example%2Fwidgets&amp;rut=xyz">
                Widgets - Official Store
            </a>
        </h2>
        <a class="result__snippet">Buy the official widget. Free shipping on all orders.</a>
    </div>
</div>
"#;
        let results = core_search::parse_duckduckgo_results(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Widgets - Official Store");
        assert_eq!(results[0].url, "https://shop.example/widgets");
        assert_eq!(
            results[0].snippet,
            "Buy the official widget. Free shipping on all orders."
        );
    }

    #[test]
    fn test_parse_results_empty_for_blank_no_result_and_challenge_pages() {
        assert!(core_search::parse_duckduckgo_results("", 5).is_empty());
        assert!(core_search::parse_duckduckgo_results("   \n\t  ", 5).is_empty());

        let no_results = r#"
<!DOCTYPE html>
<html lang="en">
<body>
<div class="no-results">
    <h1 class="no-results__header">No results</h1>
    <p>Your search - "zzqxjwv" - did not match any documents.</p>
    <p>Suggestions: make sure all words are spelled correctly.</p>
</div>
</body>
</html>
"#;
        assert!(core_search::parse_duckduckgo_results(no_results, 5).is_empty());

        let challenge = r#"
<!DOCTYPE html>
<html lang="en">
<body>
<div class="anomaly-notification">
    <p>If this persists, please let us know at duckduckgo.com/feedback.</p>
</div>
<form action="/html" method="post"><input type="hidden" name="kl" value="wt-wt"></form>
</body>
</html>
"#;
        assert!(core_search::parse_duckduckgo_results(challenge, 5).is_empty());
    }

    #[test]
    fn test_parse_results_max_applies_to_blocks_before_filtering() {
        let html = r#"
<div class="result"><a class="result__a" href="https://a.example">A</a></div>
<div class="result"><a class="result__snippet">no title link</a></div>
<div class="result"><a class="result__a" href="https://b.example">B</a></div>
<div class="result"><a class="result__a" href="https://c.example">C</a></div>
"#;
        // The limit slices result blocks before validation, so an invalid
        // block inside the window consumes one of the slots.
        let results = core_search::parse_duckduckgo_results(html, 3);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "A");
        assert_eq!(results[1].title, "B");

        assert!(core_search::parse_duckduckgo_results(html, 0).is_empty());
    }

    #[test]
    fn test_parse_results_preserves_cjk_text_and_decodes_paths() {
        // CJK fixture set covering Chinese, Japanese, and Korean together.
        let html = r#"
<div class="result">
    <a class="result__a"
       href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fzh.wikipedia.org%2Fwiki%2F%E4%B8%AD%E6%96%87%E8%AF%AD%E8%A8%80&amp;rut=1">
        中文维基百科 - 语言条目
    </a>
    <a class="result__snippet">中文条目摘要文本</a>
</div>
<div class="result">
    <a class="result__a"
       href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fja.wikipedia.org%2Fwiki%2F%E8%A8%80%E8%AA%9E&amp;rut=2">
        日本語タイトル - ウィキペディア
    </a>
    <a class="result__snippet">日本語のスニペットテキスト</a>
</div>
<div class="result">
    <a class="result__a" href="https://ko.wikipedia.org/wiki/언어">한국어 제목 - 위키백과</a>
    <a class="result__snippet">한국어 스니펫 텍스트</a>
</div>
"#;
        let results = core_search::parse_duckduckgo_results(html, 10);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "中文维基百科 - 语言条目");
        assert_eq!(results[0].url, "https://zh.wikipedia.org/wiki/中文语言");
        assert_eq!(results[0].snippet, "中文条目摘要文本");
        assert_eq!(results[1].title, "日本語タイトル - ウィキペディア");
        assert_eq!(results[1].url, "https://ja.wikipedia.org/wiki/言語");
        assert_eq!(results[1].snippet, "日本語のスニペットテキスト");
        assert_eq!(results[2].title, "한국어 제목 - 위키백과");
        assert_eq!(results[2].url, "https://ko.wikipedia.org/wiki/언어");
        assert_eq!(results[2].snippet, "한국어 스니펫 텍스트");
    }

    // ---- resolve_duckduckgo_redirect_url decoding edge cases ----

    #[test]
    fn test_extract_actual_url_preserves_target_query_params() {
        let href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Drust%26page%3D2&rut=abc";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "https://example.com/search?q=rust&page=2");
    }

    #[test]
    fn test_extract_actual_url_y_js_ad_redirect() {
        let href =
            "//duckduckgo.com/y.js?ad_domain=shop.example&uddg=https%3A%2F%2Fshop.example%2F&rut=x";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "https://shop.example/");
    }

    #[test]
    fn test_extract_actual_url_unencoded_target_params() {
        let href = "//duckduckgo.com/l/?uddg=https://example.com/docs?id=42";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "https://example.com/docs?id=42");
    }

    #[test]
    fn test_extract_actual_url_empty_uddg_falls_back_to_wrapper() {
        let href = "//duckduckgo.com/l/?uddg=&rut=abc";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "https://duckduckgo.com/l/?uddg=&rut=abc");
    }

    #[test]
    fn test_extract_actual_url_non_http_target_falls_back_to_wrapper() {
        let href = "//duckduckgo.com/l/?uddg=mailto%3Asupport%40example.com&rut=abc";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(
            result,
            "https://duckduckgo.com/l/?uddg=mailto%3Asupport%40example.com&rut=abc"
        );
    }

    #[test]
    fn test_extract_actual_url_relative_path_unchanged() {
        let href = "/html/?q=test";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "/html/?q=test");
    }

    #[test]
    fn test_extract_actual_url_plain_http_preserved() {
        let href = "http://example.com/insecure";
        let result = core_search::resolve_duckduckgo_redirect_url(href);
        assert_eq!(result, "http://example.com/insecure");
    }

    #[test]
    fn test_extract_actual_url_empty_href_stays_empty() {
        assert_eq!(core_search::resolve_duckduckgo_redirect_url(""), "");
    }
}
