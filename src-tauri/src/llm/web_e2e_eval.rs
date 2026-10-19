//! Real-network E2E for the web tools (`web_fetch`, `web_search`).
//!
//! Test-only; excluded from normal runs. These hit the real internet —
//! DNS, TLS, live HTML extraction, live search engines — so they are
//! env-gated instead of running against the local mock:
//!
//! ```sh
//! # web_fetch: fetch and extract a real page (example.com is IANA-stable)
//! CHATSHELL_WEB_E2E_FETCH_URL=https://example.com \
//! cargo test --lib web_e2e -- --ignored --nocapture
//!
//! # web_search: run a real query through the engine fallback chain
//! CHATSHELL_WEB_E2E_QUERY=internet assigned numbers authority \
//! cargo test --lib web_e2e -- --ignored --nocapture
//! ```
//!
//! Env contract:
//! - `CHATSHELL_WEB_E2E_FETCH_URL`  enables the fetch test; the page's
//!   extracted text must be non-empty (example.com also asserts content)
//! - `CHATSHELL_WEB_E2E_QUERY`      enables the search test; at least one
//!   result with an http(s) URL must come back

#[cfg(test)]
mod tests {
    use rig::agent::tool::{Tool, ToolContext};

    use crate::llm::tools::{WebFetchArgs, WebFetchTool, WebSearchArgs, WebSearchTool};

    #[tokio::test]
    #[ignore = "real-network E2E: set CHATSHELL_WEB_E2E_FETCH_URL to enable (e.g. https://example.com)"]
    async fn web_fetch_real_page_roundtrip() {
        let Ok(url) = std::env::var("CHATSHELL_WEB_E2E_FETCH_URL") else {
            println!(
                "skipping web_fetch E2E: set CHATSHELL_WEB_E2E_FETCH_URL=https://example.com \
                 to fetch a real page"
            );
            return;
        };
        println!("web_fetch E2E target: {url}");

        let tool = WebFetchTool::new();
        let mut context = ToolContext::new();
        let is_example = url.contains("example.com");
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(90),
            tool.call(
                &mut context,
                WebFetchArgs {
                    url,
                    max_chars: None,
                    mode: None,
                },
            ),
        )
        .await
        .expect("fetch must finish within the timeout")
        .expect("web_fetch must succeed against the real endpoint");

        println!(
            "web_fetch E2E output (first 500 chars): {}",
            &output[..output.len().min(500)]
        );
        let lowered = output.to_lowercase();
        assert!(
            !lowered.contains("error fetching") && !lowered.contains("fetch failed"),
            "extraction must not be an error report: {output}"
        );
        assert!(
            !output.trim().is_empty(),
            "extracted content must be non-empty"
        );
        if is_example {
            assert!(
                lowered.contains("example domain"),
                "example.com extraction must contain its title text: {output}"
            );
        }
    }

    #[tokio::test]
    #[ignore = "real-network E2E: set CHATSHELL_WEB_E2E_QUERY to enable"]
    async fn web_search_real_query_roundtrip() {
        let Ok(query) = std::env::var("CHATSHELL_WEB_E2E_QUERY") else {
            println!(
                "skipping web_search E2E: set CHATSHELL_WEB_E2E_QUERY=<query> to run a \
                 real search through the engine fallback chain"
            );
            return;
        };
        println!("web_search E2E query: {query}");

        let tool = WebSearchTool::new();
        let mut context = ToolContext::new();
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(180),
            tool.call(
                &mut context,
                WebSearchArgs {
                    query,
                    max_results: 5,
                    provider: None,
                },
            ),
        )
        .await
        .expect("search must finish within the timeout")
        .expect("web_search must succeed through at least one engine");

        println!(
            "web_search E2E output (first 500 chars): {}",
            &output[..output.len().min(500)]
        );
        assert!(
            output.contains("## Search Results for:"),
            "results must render in the tool's markdown format: {output}"
        );
        assert!(
            output.contains("**URL:** http"),
            "at least one result with an http(s) URL must come back: {output}"
        );
    }
}
