//! Web search module for DuckDuckGo search using headless Chrome
//!
//! This module provides web search functionality that uses headless Chrome
//! with stealth mode to bypass bot detection and perform DuckDuckGo searches.

use anyhow::Result;
use chrono::Utc;
use rig::client::CompletionClient;
use rig::completion::Prompt;
use rig::providers::{ollama, openai};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use url::form_urlencoded;

use crate::prompts::SEARCH_DECISION_SYSTEM_PROMPT;
use crate::web_fetch::{STEALTH_JS, create_new_browser};

/// A single search result item from DuckDuckGo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Response from DuckDuckGo search
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuckDuckGoSearchResponse {
    pub query: String,
    pub results: Vec<SearchResultItem>,
    pub total_results: usize,
    pub searched_at: String,
}

/// Result from AI search decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDecisionResult {
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
}

/// Use AI to decide if web search is needed for the given user input
/// Uses the same provider/model as the current conversation
pub async fn decide_search_needed(
    user_input: &str,
    provider: &str,
    model: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> Result<SearchDecisionResult> {
    println!(
        "🤔 [search_decision] Asking AI if search is needed for: {}",
        user_input.chars().take(100).collect::<String>()
    );

    let response = match provider {
        "openai" => {
            let api_key = api_key.ok_or_else(|| anyhow::anyhow!("API key required for OpenAI"))?;

            let client = openai::Client::new(api_key);
            let agent = client
                .agent(model)
                .preamble(SEARCH_DECISION_SYSTEM_PROMPT)
                .build();

            agent
                .prompt(user_input)
                .await
                .map_err(|e| anyhow::anyhow!("OpenAI request failed: {}", e))?
        }
        "openrouter" => {
            let api_key =
                api_key.ok_or_else(|| anyhow::anyhow!("API key required for OpenRouter"))?;

            let client = openai::Client::builder(api_key)
                .base_url("https://openrouter.ai/api/v1")
                .build();
            let agent = client
                .agent(model)
                .preamble(SEARCH_DECISION_SYSTEM_PROMPT)
                .build();

            agent
                .prompt(user_input)
                .await
                .map_err(|e| anyhow::anyhow!("OpenRouter request failed: {}", e))?
        }
        "ollama" => {
            let base = base_url.unwrap_or("http://localhost:11434");
            let client = ollama::Client::builder().base_url(base).build();
            let agent = client
                .agent(model)
                .preamble(SEARCH_DECISION_SYSTEM_PROMPT)
                .build();

            agent
                .prompt(user_input)
                .await
                .map_err(|e| anyhow::anyhow!("Ollama request failed: {}", e))?
        }
        _ => {
            return Err(anyhow::anyhow!(
                "Unsupported provider for search decision: {}",
                provider
            ));
        }
    };

    println!("📝 [search_decision] AI response: {}", response);

    // Parse JSON from response
    let json_str = extract_json_from_response(&response)?;
    let parsed: Value = serde_json::from_str(&json_str)
        .map_err(|e| anyhow::anyhow!("Failed to parse JSON: {}", e))?;

    let result = SearchDecisionResult {
        reasoning: parsed["reasoning"].as_str().unwrap_or("").to_string(),
        search_needed: parsed["search_needed"].as_bool().unwrap_or(false),
        search_query: parsed["search_query"].as_str().map(|s| s.to_string()),
    };

    println!(
        "✅ [search_decision] Decision: search_needed={}, query={:?}",
        result.search_needed, result.search_query
    );

    Ok(result)
}

/// Extract JSON from AI response (handles markdown code blocks)
fn extract_json_from_response(response: &str) -> Result<String> {
    let trimmed = response.trim();

    // Try to find JSON in code block
    if let Some(start) = trimmed.find("```json") {
        let json_start = start + 7;
        if let Some(end) = trimmed[json_start..].find("```") {
            return Ok(trimmed[json_start..json_start + end].trim().to_string());
        }
    }

    // Try to find JSON in generic code block
    if let Some(start) = trimmed.find("```") {
        let block_start = start + 3;
        let content_start = trimmed[block_start..]
            .find('\n')
            .map(|i| block_start + i + 1)
            .unwrap_or(block_start);
        if let Some(end) = trimmed[content_start..].find("```") {
            return Ok(trimmed[content_start..content_start + end]
                .trim()
                .to_string());
        }
    }

    // Try to find raw JSON object
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            return Ok(trimmed[start..=end].to_string());
        }
    }

    Err(anyhow::anyhow!("No JSON found in response"))
}

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
}
