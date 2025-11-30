use anyhow::Result;
use chrono::Utc;
use futures::future::join_all;
use headless_chrome::{Browser, LaunchOptions};
use lazy_static::lazy_static;
use readability::extractor::extract;
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Cursor;
use std::time::Duration;
use url::Url;

/// Metadata for web fetch results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebFetchMetadata {
    pub keywords: Option<String>,
    pub headings: Vec<String>,
    pub fetched_at: String,
    pub original_length: Option<usize>,
    pub truncated: bool,
    pub favicon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchedWebResource {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub mime_type: String,
    pub content_format: String, // MIME type of converted content (e.g., "text/markdown")
    pub content: String,
    pub extraction_error: Option<String>,
    pub metadata: WebFetchMetadata,
}

lazy_static! {
    /// Shared HTTP client with connection pooling
    static ref HTTP_CLIENT: Client = Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (compatible; ChatShell/1.0)")
        .build()
        .expect("Failed to create HTTP client");

    static ref URL_REGEX: Regex = Regex::new(
        r"https?://(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&/=]*)"
    ).expect("Invalid URL regex pattern");

    /// Regex to match complete img tags
    static ref IMG_TAG_REGEX: Regex = Regex::new(
        r#"(?i)<img\s[^>]*?/?>"#
    ).expect("Invalid img tag regex");

    /// Regex to extract src attribute from img tag
    static ref IMG_SRC_REGEX: Regex = Regex::new(
        r#"(?i)src\s*=\s*["']([^"']+)["']"#
    ).expect("Invalid src regex");

    /// Regex to extract alt attribute from img tag
    static ref IMG_ALT_REGEX: Regex = Regex::new(
        r#"(?i)alt\s*=\s*["']([^"']*)["']"#
    ).expect("Invalid alt regex");

    /// Stealth JavaScript to hide headless browser detection
    pub static ref STEALTH_JS: String = r#"
        // Override webdriver property
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        
        // Override plugins to look like a real browser
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        
        // Override languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
        
        // Add chrome runtime (missing in headless)
        window.chrome = {
            runtime: {},
        };
        
        // Override permissions query
        if (window.navigator.permissions) {
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        }
    "#.to_string();
}

/// Create a new headless browser instance
pub fn create_new_browser() -> Result<Browser> {
    println!("🌐 [headless] Creating new browser instance...");

    let launch_options = LaunchOptions::default_builder()
        .headless(true)
        .window_size(Some((1920, 1080)))
        .idle_browser_timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| anyhow::anyhow!("Failed to build launch options: {}", e))?;

    let browser = Browser::new(launch_options)
        .map_err(|e| anyhow::anyhow!("Failed to launch browser: {}", e))?;

    println!("✅ [headless] Browser instance created");
    Ok(browser)
}

/// Fetch webpage content using headless Chrome browser
/// This is used as a fallback when direct HTTP fetch fails (e.g., 403 errors from bot protection)
fn fetch_with_headless_browser(url: &str) -> Result<String> {
    println!("🔄 [headless] Fetching with headless browser: {}", url);

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

    // Navigate to a blank page first to inject stealth JS
    tab.navigate_to("about:blank")
        .map_err(|e| anyhow::anyhow!("Failed to navigate to blank: {}", e))?;
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Blank navigation timeout: {}", e))?;

    // Inject stealth JavaScript to hide headless detection
    tab.evaluate(&*STEALTH_JS, false)
        .map_err(|e| anyhow::anyhow!("Failed to inject stealth JS: {}", e))?;

    println!("🛡️ [headless] Stealth mode enabled, navigating to target...");

    // Navigate to the actual URL
    tab.navigate_to(url)
        .map_err(|e| anyhow::anyhow!("Failed to navigate: {}", e))?;

    // Wait for navigation to complete
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Navigation timeout: {}", e))?;

    // Wait for Cloudflare challenge to complete (usually takes 5-10 seconds)
    println!("⏳ [headless] Waiting for page to load (Cloudflare check)...");
    std::thread::sleep(Duration::from_secs(8));

    // Check if we're still on the challenge page
    let mut html = tab
        .get_content()
        .map_err(|e| anyhow::anyhow!("Failed to get page content: {}", e))?;

    // If still showing challenge, wait more and retry
    let challenge_indicators = [
        "Just a moment",
        "Verifying",
        "checking your browser",
        "Please wait",
        "Checking if the site",
    ];
    let mut retries = 0;
    while retries < 3 && challenge_indicators.iter().any(|ind| html.contains(ind)) {
        println!(
            "⏳ [headless] Still on challenge page, waiting more... (retry {})",
            retries + 1
        );
        std::thread::sleep(Duration::from_secs(5));
        html = tab
            .get_content()
            .map_err(|e| anyhow::anyhow!("Failed to get page content: {}", e))?;
        retries += 1;
    }

    if challenge_indicators.iter().any(|ind| html.contains(ind)) {
        return Err(anyhow::anyhow!(
            "Cloudflare challenge could not be bypassed after {} retries",
            retries
        ));
    }

    println!("✅ [headless] Successfully fetched {} bytes", html.len());

    Ok(html)
}

/// Async wrapper for headless browser fallback
/// Runs the blocking headless browser operation in a separate thread
async fn fetch_with_headless_fallback(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    let url_owned = url.to_string();

    // Run headless browser in blocking thread to avoid blocking async runtime
    let html_result =
        tokio::task::spawn_blocking(move || fetch_with_headless_browser(&url_owned)).await;

    match html_result {
        Ok(Ok(html)) => {
            // Successfully got HTML from headless browser
            let favicon_url = extract_favicon_url(url, Some(&html));
            process_html_with_readability(
                url,
                &html,
                "text/html".to_string(),
                max_chars,
                favicon_url,
            )
        }
        Ok(Err(e)) => {
            // Headless browser fetch failed
            create_error_response(
                url,
                "text/html".to_string(),
                format!("Headless browser fetch failed: {}", e),
                None,
            )
        }
        Err(e) => {
            // Task join error
            create_error_response(
                url,
                "text/html".to_string(),
                format!("Headless browser task failed: {}", e),
                None,
            )
        }
    }
}

/// Extract and validate URLs from text, with deduplication
pub fn extract_urls(text: &str) -> Vec<String> {
    URL_REGEX
        .find_iter(text)
        .filter_map(|m| {
            let url_str = m.as_str();
            // Validate URL using the url crate
            Url::parse(url_str).ok().map(|u| u.to_string())
        })
        .collect::<HashSet<_>>() // Deduplicate
        .into_iter()
        .collect()
}

/// Extract favicon URL from HTML document
fn extract_favicon_from_html(document: &Html, base_url: &Url) -> Option<String> {
    // Try multiple selectors for favicon
    let selectors = [
        r#"link[rel="icon"]"#,
        r#"link[rel="shortcut icon"]"#,
        r#"link[rel="apple-touch-icon"]"#,
        r#"link[rel="apple-touch-icon-precomposed"]"#,
    ];

    for selector_str in &selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            for element in document.select(&selector) {
                if let Some(href) = element.value().attr("href") {
                    // Resolve relative URL to absolute
                    if let Ok(favicon_url) = base_url.join(href) {
                        return Some(favicon_url.to_string());
                    }
                }
            }
        }
    }

    None
}

/// Extract favicon URL from HTML content only
/// Returns None if favicon cannot be extracted from HTML (frontend will show globe icon)
fn extract_favicon_url(url: &str, html_content: Option<&str>) -> Option<String> {
    let parsed_url = Url::parse(url).ok()?;

    // Only extract favicon from HTML content
    if let Some(html) = html_content {
        let document = Html::parse_document(html);
        if let Some(favicon) = extract_favicon_from_html(&document, &parsed_url) {
            println!("✅ [favicon] Found icon in HTML for {}: {}", url, favicon);
            return Some(favicon);
        }
    }

    // No favicon found - frontend will display globe icon
    None
}

fn extract_meta_description(document: &Html) -> Option<String> {
    // Try standard description meta tag
    let desc = Selector::parse(r#"meta[name="description"]"#)
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if desc.is_some() {
        return desc;
    }

    // Fallback to Open Graph description
    Selector::parse(r#"meta[property="og:description"]"#)
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_meta_keywords(document: &Html) -> Option<String> {
    Selector::parse(r#"meta[name="keywords"]"#)
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_headings(document: &Html) -> Vec<String> {
    Selector::parse("h1, h2, h3")
        .ok()
        .map(|sel| {
            document
                .select(&sel)
                .take(10)
                .map(|el| el.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Truncate string by character count (not bytes), returns (truncated_string, was_truncated)
fn truncate_by_chars(s: &str, max_chars: usize) -> (String, bool) {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        (s.to_string(), false)
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        (
            format!(
                "{}\n\n[Content truncated - original length: {} characters]",
                truncated, char_count
            ),
            true,
        )
    }
}

/// Normalize HTML img tags to simple format for better html2md conversion
/// Handles complex img tags with srcset, sizes, and other attributes
/// Converts them to simple <img src="..." alt="..."> format
fn normalize_html_images(html: &str) -> String {
    IMG_TAG_REGEX
        .replace_all(html, |caps: &regex::Captures| {
            let img_tag = &caps[0];

            // Extract src attribute
            let src = IMG_SRC_REGEX
                .captures(img_tag)
                .map(|c| c[1].to_string())
                .unwrap_or_default();

            // Skip if no src found
            if src.is_empty() {
                return img_tag.to_string();
            }

            // Extract alt attribute (default to empty string)
            let alt = IMG_ALT_REGEX
                .captures(img_tag)
                .map(|c| c[1].to_string())
                .unwrap_or_default();

            format!(r#"<img src="{}" alt="{}">"#, src, alt)
        })
        .to_string()
}

/// Create an error response with default metadata
fn create_error_response(
    url: &str,
    mime_type: String,
    error: String,
    favicon_url: Option<String>,
) -> FetchedWebResource {
    FetchedWebResource {
        url: url.to_string(),
        title: None,
        description: None,
        mime_type: mime_type.clone(),
        content_format: mime_type,
        content: String::new(),
        extraction_error: Some(error),
        metadata: WebFetchMetadata {
            keywords: None,
            headings: vec![],
            fetched_at: Utc::now().to_rfc3339(),
            original_length: None,
            truncated: false,
            favicon_url,
        },
    }
}

/// Process HTML content using Mozilla's Readability algorithm and convert to markdown
fn process_html_with_readability(
    url: &str,
    html_content: &str,
    mime_type: String,
    max_chars: Option<usize>,
    favicon_url: Option<String>,
) -> FetchedWebResource {
    // Parse document for metadata extraction
    let document = Html::parse_document(html_content);
    let description = extract_meta_description(&document);
    let keywords = extract_meta_keywords(&document);
    let headings = extract_headings(&document);

    // Use Readability algorithm for main content extraction
    let parsed_url = match Url::parse(url) {
        Ok(u) => u,
        Err(e) => {
            return create_error_response(
                url,
                mime_type,
                format!("Invalid URL: {}", e),
                favicon_url,
            );
        }
    };

    // Create a cursor from the HTML content for readability
    let mut cursor = Cursor::new(html_content.as_bytes());

    let (title, content_html) = match extract(&mut cursor, &parsed_url) {
        Ok(product) => {
            println!(
                "📖 [readability] Extracted article: {} ({} chars)",
                product.title,
                product.content.len()
            );
            (Some(product.title), product.content)
        }
        Err(e) => {
            println!("⚠️ [readability] Extraction failed: {}, using fallback", e);
            // Fallback: use the entire body
            let title = Selector::parse("title")
                .ok()
                .and_then(|sel| document.select(&sel).next())
                .map(|el| el.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty());

            let body_html = Selector::parse("body")
                .ok()
                .and_then(|sel| document.select(&sel).next())
                .map(|el| el.html())
                .unwrap_or_else(|| html_content.to_string());

            (title, body_html)
        }
    };

    // Normalize img tags before markdown conversion to handle complex attributes
    let normalized_html = normalize_html_images(&content_html);

    // Convert extracted HTML to markdown
    let markdown = html2md::parse_html(&normalized_html);
    let original_length = markdown.chars().count();

    let (extracted_content, truncated) = match max_chars {
        Some(limit) => truncate_by_chars(&markdown, limit),
        None => (markdown, false),
    };

    // Clean up whitespace
    let cleaned_content = extracted_content
        .lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    FetchedWebResource {
        url: url.to_string(),
        title,
        description,
        mime_type,
        content_format: "text/markdown".to_string(),
        content: cleaned_content,
        extraction_error: None,
        metadata: WebFetchMetadata {
            keywords,
            headings,
            fetched_at: Utc::now().to_rfc3339(),
            original_length: Some(original_length),
            truncated,
            favicon_url,
        },
    }
}

/// Process plain text content
fn process_text_content(
    url: &str,
    text_content: &str,
    mime_type: String,
    max_chars: Option<usize>,
    favicon_url: Option<String>,
) -> FetchedWebResource {
    let original_length = text_content.chars().count();
    let (content, truncated) = match max_chars {
        Some(limit) => truncate_by_chars(text_content, limit),
        None => (text_content.to_string(), false),
    };

    FetchedWebResource {
        url: url.to_string(),
        title: None,
        description: None,
        mime_type: mime_type.clone(),
        content_format: mime_type,
        content,
        extraction_error: None,
        metadata: WebFetchMetadata {
            keywords: None,
            headings: vec![],
            fetched_at: Utc::now().to_rfc3339(),
            original_length: Some(original_length),
            truncated,
            favicon_url,
        },
    }
}

/// Process JSON content (format as code block)
fn process_json_content(
    url: &str,
    json_content: &str,
    max_chars: Option<usize>,
    favicon_url: Option<String>,
) -> FetchedWebResource {
    // Pretty-print JSON if possible
    let formatted = serde_json::from_str::<serde_json::Value>(json_content)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok())
        .unwrap_or_else(|| json_content.to_string());

    let markdown_content = format!("```json\n{}\n```", formatted);
    let original_length = markdown_content.chars().count();

    let (content, truncated) = match max_chars {
        Some(limit) => truncate_by_chars(&markdown_content, limit),
        None => (markdown_content, false),
    };

    FetchedWebResource {
        url: url.to_string(),
        title: None,
        description: Some("JSON data".to_string()),
        mime_type: "application/json".to_string(),
        content_format: "text/markdown".to_string(),
        content,
        extraction_error: None,
        metadata: WebFetchMetadata {
            keywords: None,
            headings: vec![],
            fetched_at: Utc::now().to_rfc3339(),
            original_length: Some(original_length),
            truncated,
            favicon_url,
        },
    }
}

/// Fetch and parse a web resource using Mozilla's Readability algorithm for HTML.
/// max_chars: None = no truncation, Some(n) = truncate to n characters
/// Falls back to headless browser if direct HTTP fetch fails with non-200 status.
pub async fn fetch_web_resource(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    println!("📡 [fetcher] Starting fetch for: {}", url);

    // Validate URL first
    if Url::parse(url).is_err() {
        return create_error_response(url, String::new(), format!("Invalid URL: {}", url), None);
    }

    println!("📨 [fetcher] Sending HTTP request...");

    let response = match HTTP_CLIENT
        .get(url)
        .header("Accept", "text/markdown, text/html, */*")
        .header("Accept-Encoding", "gzip, deflate, br, zstd")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // Network error - try headless browser fallback
            println!(
                "⚠️ [fetcher] HTTP request failed: {}, trying headless browser...",
                e
            );
            return fetch_with_headless_fallback(url, max_chars).await;
        }
    };

    println!("📥 [fetcher] Got response, status: {}", response.status());

    // If non-200 status, try headless browser fallback
    if !response.status().is_success() {
        println!(
            "⚠️ [fetcher] HTTP error {}, trying headless browser fallback...",
            response.status()
        );
        return fetch_with_headless_fallback(url, max_chars).await;
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let mime_type = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    let body = match response.text().await {
        Ok(c) => c,
        Err(e) => {
            return create_error_response(
                url,
                mime_type,
                format!("Failed to read response body: {}", e),
                None,
            );
        }
    };

    // Handle different content types
    match mime_type.clone().as_str() {
        // HTML content - use Readability algorithm for extraction
        "text/html" | "application/xhtml+xml" => {
            // Extract favicon from HTML content
            let favicon_url = extract_favicon_url(url, Some(&body));
            process_html_with_readability(url, &body, mime_type, max_chars, favicon_url)
        }

        // Markdown - return directly (no favicon for non-HTML)
        "text/markdown" | "text/x-markdown" => {
            process_text_content(url, &body, "text/markdown".to_string(), max_chars, None)
        }

        // Plain text - return directly (no favicon for non-HTML)
        "text/plain" => process_text_content(url, &body, mime_type, max_chars, None),

        // JSON - format as code block (no favicon for non-HTML)
        "application/json" => process_json_content(url, &body, max_chars, None),

        // XML - treat as text with code block (no favicon for non-HTML)
        "application/xml" | "text/xml" => {
            let markdown_content = format!("```xml\n{}\n```", body);
            let original_length = markdown_content.chars().count();
            let (content, truncated) = match max_chars {
                Some(limit) => truncate_by_chars(&markdown_content, limit),
                None => (markdown_content, false),
            };
            FetchedWebResource {
                url: url.to_string(),
                title: None,
                description: Some("XML data".to_string()),
                mime_type,
                content_format: "text/markdown".to_string(),
                content,
                extraction_error: None,
                metadata: WebFetchMetadata {
                    keywords: None,
                    headings: vec![],
                    fetched_at: Utc::now().to_rfc3339(),
                    original_length: Some(original_length),
                    truncated,
                    favicon_url: None,
                },
            }
        }

        // Unsupported binary types (no favicon for binary content)
        mime if mime.starts_with("image/")
            || mime.starts_with("audio/")
            || mime.starts_with("video/")
            || mime == "application/pdf"
            || mime == "application/octet-stream" =>
        {
            create_error_response(
                url,
                mime_type,
                format!(
                    "Unsupported content type: {}. Binary content cannot be processed.",
                    mime
                ),
                None,
            )
        }

        // Unknown types - try to parse as HTML (many sites don't set content-type correctly)
        _ => {
            // Check if it looks like HTML
            let trimmed = body.trim();
            if trimmed.starts_with("<!DOCTYPE")
                || trimmed.starts_with("<!doctype")
                || trimmed.starts_with("<html")
                || trimmed.starts_with("<HTML")
            {
                let favicon_url = extract_favicon_url(url, Some(&body));
                process_html_with_readability(
                    url,
                    &body,
                    "text/html".to_string(),
                    max_chars,
                    favicon_url,
                )
            } else {
                // Treat as plain text (no favicon for non-HTML)
                process_text_content(url, &body, mime_type, max_chars, None)
            }
        }
    }
}

pub async fn fetch_and_convert_to_markdown(url: &str, max_chars: Option<usize>) -> Result<String> {
    let result = fetch_web_resource(url, max_chars).await;
    if let Some(error) = result.extraction_error {
        return Err(anyhow::anyhow!("{}", error));
    }
    Ok(result.content)
}

/// Process multiple URLs in parallel (extracts URLs from content)
pub async fn process_message_urls(
    content: &str,
    max_chars: Option<usize>,
) -> Vec<FetchedWebResource> {
    let urls = extract_urls(content);
    fetch_urls(&urls, max_chars).await
}

/// Fetch multiple URLs in parallel (takes a list of URLs directly)
pub async fn fetch_urls(urls: &[String], max_chars: Option<usize>) -> Vec<FetchedWebResource> {
    if urls.is_empty() {
        return vec![];
    }

    println!("🌐 [fetcher] Processing {} URLs in parallel", urls.len());

    let futures: Vec<_> = urls
        .iter()
        .map(|url| {
            let url = url.clone();
            async move {
                println!("🔗 [fetcher] Fetching: {}", url);
                let result = fetch_web_resource(&url, max_chars).await;
                println!(
                    "✅ [fetcher] Completed: {} (error: {:?})",
                    url, result.extraction_error
                );
                result
            }
        })
        .collect();

    let results = join_all(futures).await;

    println!("📦 [fetcher] All {} URLs processed", results.len());
    results
}

pub fn build_llm_content_with_attachments(
    original_content: &str,
    fetched_resources: &[FetchedWebResource],
) -> String {
    if fetched_resources.is_empty() {
        return original_content.to_string();
    }

    let mut content = original_content.to_string();

    for resource in fetched_resources {
        if resource.extraction_error.is_some() {
            content.push_str(&format!(
                "\n\n---\n**Note:** Could not fetch content from {}: {}",
                resource.url,
                resource
                    .extraction_error
                    .as_deref()
                    .unwrap_or("Unknown error")
            ));
        } else {
            content.push_str(&format!(
                "\n\n---\n**Content from {}:**\n\n{}",
                resource.url,
                resource.content.trim()
            ));
        }
    }

    content
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_urls() {
        let text = "Check out https://example.com and http://test.org/path?query=1";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 2);
        assert!(urls.contains(&"https://example.com/".to_string()));
        assert!(urls.contains(&"http://test.org/path?query=1".to_string()));
    }

    #[test]
    fn test_extract_urls_deduplication() {
        let text = "Visit https://example.com and then https://example.com again";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 1);
    }

    #[test]
    fn test_extract_urls_invalid() {
        let text = "This is not a valid URL: http://";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 0);
    }

    #[test]
    fn test_no_urls() {
        let text = "This is a message without any URLs";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 0);
    }

    #[test]
    fn test_truncate_by_chars() {
        let text = "Hello, World!";
        let (truncated, was_truncated) = truncate_by_chars(text, 5);
        assert!(was_truncated);
        assert!(truncated.starts_with("Hello"));
        assert!(truncated.contains("[Content truncated"));
    }

    #[test]
    fn test_truncate_by_chars_no_truncation() {
        let text = "Hello";
        let (result, was_truncated) = truncate_by_chars(text, 10);
        assert!(!was_truncated);
        assert_eq!(result, "Hello");
    }

    #[test]
    fn test_normalize_html_images_with_srcset() {
        let html = r#"<img src="https://example.com/image.jpg!720" alt="" width="1920" height="1080" srcset="https://example.com/image.jpg!720 1920w, https://example.com/image-360.jpg 360w" sizes="(max-width: 1920px) 100vw, 1920px">"#;
        let result = normalize_html_images(html);
        assert_eq!(
            result,
            r#"<img src="https://example.com/image.jpg!720" alt="">"#
        );
    }

    #[test]
    fn test_normalize_html_images_with_alt() {
        let html = r#"<img src="https://example.com/photo.png" alt="A beautiful sunset" class="responsive">"#;
        let result = normalize_html_images(html);
        assert_eq!(
            result,
            r#"<img src="https://example.com/photo.png" alt="A beautiful sunset">"#
        );
    }

    #[test]
    fn test_normalize_html_images_alt_before_src() {
        let html = r#"<img alt="Test image" src="https://example.com/test.jpg" width="100">"#;
        let result = normalize_html_images(html);
        assert_eq!(
            result,
            r#"<img src="https://example.com/test.jpg" alt="Test image">"#
        );
    }

    #[test]
    fn test_normalize_html_images_self_closing() {
        let html = r#"<img src="https://example.com/image.jpg" alt="test" />"#;
        let result = normalize_html_images(html);
        assert_eq!(
            result,
            r#"<img src="https://example.com/image.jpg" alt="test">"#
        );
    }

    #[test]
    fn test_normalize_html_images_multiple() {
        let html = r#"<p><img src="https://a.com/1.jpg" alt="first" srcset="..."></p><p><img src="https://b.com/2.jpg" alt="second"></p>"#;
        let result = normalize_html_images(html);
        assert!(result.contains(r#"<img src="https://a.com/1.jpg" alt="first">"#));
        assert!(result.contains(r#"<img src="https://b.com/2.jpg" alt="second">"#));
    }
}
