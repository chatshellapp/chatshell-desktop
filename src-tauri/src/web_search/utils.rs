//! Utility functions for web search

use std::time::Duration;

use chatshell_agent_core::web_search::SearchResult;

use super::types::SearchResultItem;
use crate::web_fetch::{
    HTTP_CLIENT, obscura_fetch_html, obscura_is_configured, webview_fetch_html,
    webview_is_available,
};

/// Realistic UA for plain-HTTP SERP requests; engines hard-block the default
/// reqwest UA. Matches the UA the headless Chrome path sets.
const SERP_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Scrape a search-engine result page: plain HTTP first (cheap, works for
/// engines that don't hard-block non-browser clients), then the browser tiers
/// — Obscura when installed on the machine, then the system WebView.
///
/// Returns `None` when every tier is unavailable/fails or every parser run
/// extracts no results; callers then fall back to headless Chrome.
pub(super) async fn scrape_search_results(
    search_url: &str,
    parse: fn(&str, usize) -> Vec<SearchResult>,
    max_results: usize,
) -> Option<Vec<SearchResultItem>> {
    if let Some(html) = try_http_serp(search_url).await {
        if let Some(results) =
            parse_tier_html(Some(html), parse, max_results, "http", search_url).await
        {
            return Some(results);
        }
    }

    if obscura_is_configured() {
        tracing::info!("🔄 [web_search] Trying obscura tier for: {}", search_url);
        if let Some(results) = parse_tier_html(
            obscura_fetch_html(search_url).await.ok(),
            parse,
            max_results,
            "obscura",
            search_url,
        )
        .await
        {
            return Some(results);
        }
    }
    if webview_is_available() {
        tracing::info!(
            "🔄 [web_search] Trying system webview tier for: {}",
            search_url
        );
        if let Some(results) = parse_tier_html(
            webview_fetch_html(search_url).await.ok(),
            parse,
            max_results,
            "webview",
            search_url,
        )
        .await
        {
            return Some(results);
        }
    }
    None
}

/// Parse one tier's HTML into result items; `None` means the tier produced
/// nothing usable and the chain should continue.
async fn parse_tier_html(
    html: Option<String>,
    parse: fn(&str, usize) -> Vec<SearchResult>,
    max_results: usize,
    tier: &str,
    search_url: &str,
) -> Option<Vec<SearchResultItem>> {
    let html = html?;
    let results = parse(&html, max_results);
    if results.is_empty() {
        tracing::warn!(
            "⚠️ [web_search] {} tier yielded no results for {}",
            tier,
            search_url
        );
        return None;
    }
    Some(
        results
            .into_iter()
            .map(|r| SearchResultItem {
                title: r.title,
                url: r.url,
                snippet: r.snippet,
            })
            .collect(),
    )
}

/// Cheapest tier: plain HTTP GET of the SERP URL. Works for engines that
/// don't hard-block non-browser clients (e.g. DuckDuckGo's html endpoint).
/// `None` on any transport error, non-200, or a suspiciously tiny body
/// (challenge interstitials and empty shells).
async fn try_http_serp(search_url: &str) -> Option<String> {
    let response = HTTP_CLIENT
        .get(search_url)
        .header("User-Agent", SERP_USER_AGENT)
        .header("Accept-Language", "en-US,en;q=0.9")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = response.text().await.ok()?;
    if body.len() < 500 {
        return None;
    }
    tracing::info!(
        "⚡ [web_search] SERP fetched via plain HTTP: {} ({} bytes)",
        search_url,
        body.len()
    );
    Some(body)
}
/// Extract search keywords from user input
///
/// This is a simple implementation that extracts the first few lines
/// and truncates to a reasonable length for search queries.
///
/// # Arguments
/// * `user_input` - The raw user input text
///
/// # Returns
/// A cleaned up string suitable for search queries
pub fn extract_search_keywords(user_input: &str) -> String {
    // Simple implementation: clean up the input
    // Take first 3 lines and join them
    let cleaned = user_input.lines().take(3).collect::<Vec<_>>().join(" ");

    // Remove extra whitespace
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");

    // Truncate to reasonable length for search
    if cleaned.len() > 150 {
        cleaned.chars().take(150).collect()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // ---- extract_search_keywords ----

    #[test]
    fn test_extract_search_keywords_short() {
        let input = "What is Rust?";
        let result = extract_search_keywords(input);
        assert_eq!(result, "What is Rust?");
    }

    #[test]
    fn test_extract_search_keywords_multiline() {
        let input = "Line one\nLine two\nLine three\nLine four";
        let result = extract_search_keywords(input);
        assert_eq!(result, "Line one Line two Line three");
    }

    #[test]
    fn test_extract_search_keywords_truncation() {
        let input = "a ".repeat(100);
        let result = extract_search_keywords(&input);
        assert!(result.len() <= 150);
    }

    #[test]
    fn test_extract_search_keywords_empty_input() {
        assert_eq!(extract_search_keywords(""), "");
    }

    #[test]
    fn test_extract_search_keywords_whitespace_only_input() {
        assert_eq!(extract_search_keywords(" \n\t  \n "), "");
    }

    #[test]
    fn test_extract_search_keywords_collapses_inner_whitespace() {
        assert_eq!(
            extract_search_keywords("rust   web\t\tframework"),
            "rust web framework"
        );
    }

    #[test]
    fn test_extract_search_keywords_truncation_counts_chars_not_bytes() {
        // 200 CJK chars are 600 UTF-8 bytes; the 150 cap is applied per char.
        let input = "密".repeat(200);
        let result = extract_search_keywords(&input);
        assert_eq!(result.chars().count(), 150);
        assert!(result.chars().all(|c| c == '密'));
    }

    #[test]
    fn test_extract_search_keywords_truncation_boundary() {
        let exactly = "x".repeat(150);
        assert_eq!(extract_search_keywords(&exactly).len(), 150);
        let over = "y".repeat(151);
        assert_eq!(extract_search_keywords(&over).len(), 150);
    }

    #[test]
    fn test_extract_search_keywords_strips_crlf_endings() {
        // `str::lines` drops the carriage return of CRLF line endings, and
        // only the first three lines participate.
        assert_eq!(
            extract_search_keywords("one\r\ntwo\nthree\nfour"),
            "one two three"
        );
    }

    // ---- parse_tier_html ----

    /// Test parser: echoes a marker from the HTML and caps at `max_results`
    /// so tests can verify both values pass through the tier chain.
    fn canned_parse(html: &str, max_results: usize) -> Vec<SearchResult> {
        let marker = html.trim();
        (0..max_results.min(3))
            .map(|i| SearchResult {
                title: format!("{marker} #{i}"),
                url: format!("https://example.com/{i}"),
                snippet: format!("snippet {i}"),
            })
            .collect()
    }

    fn empty_parse(_html: &str, _max_results: usize) -> Vec<SearchResult> {
        Vec::new()
    }

    #[tokio::test]
    async fn test_parse_tier_html_maps_and_caps_results() {
        let items = parse_tier_html(
            Some("<html>marker</html>".to_string()),
            canned_parse,
            2,
            "http",
            "http://127.0.0.1/serp",
        )
        .await
        .expect("non-empty parse should produce items");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "<html>marker</html> #0");
        assert_eq!(items[0].url, "https://example.com/0");
        assert_eq!(items[0].snippet, "snippet 0");
        assert_eq!(items[1].title, "<html>marker</html> #1");
    }

    #[tokio::test]
    async fn test_parse_tier_html_none_when_parse_extracts_nothing() {
        assert!(
            parse_tier_html(
                Some("<html>challenge shell</html>".to_string()),
                empty_parse,
                5,
                "http",
                "http://127.0.0.1/serp"
            )
            .await
            .is_none()
        );
    }

    #[tokio::test]
    async fn test_parse_tier_html_none_when_tier_yields_no_html() {
        assert!(
            parse_tier_html(None, canned_parse, 5, "obscura", "http://127.0.0.1/serp")
                .await
                .is_none()
        );
    }

    // ---- try_http_serp / scrape_search_results ----
    //
    // Same convention as the `web_fetch` tests: bind an ephemeral 127.0.0.1
    // port, answer exactly one request with a raw HTTP/1.1 response, close.

    async fn serve_one_serp(status_line: &str, body: &str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status_line = status_line.to_string();
        let body = body.to_string();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let _ = socket.read(&mut request).await;
            let headers = format!(
                "HTTP/1.1 {}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                status_line,
                body.len()
            );
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.write_all(body.as_bytes()).await.unwrap();
        });
        format!("http://{}/serp", address)
    }

    fn dead_loopback_url() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{}/serp", address)
    }

    #[tokio::test]
    async fn test_try_http_serp_returns_body_when_large_enough() {
        let body = format!("<html>{}</html>", "x".repeat(600));
        let url = serve_one_serp("200 OK", &body).await;
        assert_eq!(try_http_serp(&url).await.as_deref(), Some(body.as_str()));
    }

    #[tokio::test]
    async fn test_try_http_serp_accepts_exactly_500_byte_body() {
        let body = "y".repeat(500);
        let url = serve_one_serp("200 OK", &body).await;
        assert_eq!(try_http_serp(&url).await.as_deref(), Some(body.as_str()));
    }

    #[tokio::test]
    async fn test_try_http_serp_rejects_tiny_body() {
        // Challenge interstitials and empty shells (< 500 bytes) are dropped.
        let body = "z".repeat(499);
        let url = serve_one_serp("200 OK", &body).await;
        assert!(try_http_serp(&url).await.is_none());
    }

    #[tokio::test]
    async fn test_try_http_serp_rejects_non_success_status() {
        let body = "b".repeat(600);
        let url = serve_one_serp("403 Forbidden", &body).await;
        assert!(try_http_serp(&url).await.is_none());
    }

    #[tokio::test]
    async fn test_try_http_serp_none_on_connection_refused() {
        assert!(try_http_serp(&dead_loopback_url()).await.is_none());
    }

    #[tokio::test]
    async fn test_scrape_search_results_succeeds_on_http_tier() {
        // A parseable 200 response short-circuits the chain before the
        // obscura/webview browser tiers, keeping the test offline.
        let body = format!("<html>{}</html>", "r".repeat(600));
        let url = serve_one_serp("200 OK", &body).await;
        let results = scrape_search_results(&url, canned_parse, 2)
            .await
            .expect("http tier should win when it parses");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://example.com/0");
    }
}
