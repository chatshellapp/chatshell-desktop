use anyhow::Result;
use chrono::Utc;
use futures::future::join_all;
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

use crate::models::WebFetchMetadata;

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

/// Create an error response with default metadata
fn create_error_response(url: &str, mime_type: String, error: String) -> FetchedWebResource {
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
        },
    }
}

/// Process HTML content using Mozilla's Readability algorithm and convert to markdown
fn process_html_with_readability(
    url: &str,
    html_content: &str,
    mime_type: String,
    max_chars: Option<usize>,
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
            return create_error_response(url, mime_type, format!("Invalid URL: {}", e));
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

    // Convert extracted HTML to markdown
    let markdown = html2md::parse_html(&content_html);
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
        },
    }
}

/// Process plain text content
fn process_text_content(
    url: &str,
    text_content: &str,
    mime_type: String,
    max_chars: Option<usize>,
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
        },
    }
}

/// Process JSON content (format as code block)
fn process_json_content(
    url: &str,
    json_content: &str,
    max_chars: Option<usize>,
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
        },
    }
}

/// Fetch and parse a web resource using Mozilla's Readability algorithm for HTML.
/// max_chars: None = no truncation, Some(n) = truncate to n characters
pub async fn fetch_web_resource(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    println!("📡 [fetcher] Starting fetch for: {}", url);

    // Validate URL first
    if Url::parse(url).is_err() {
        return create_error_response(url, String::new(), format!("Invalid URL: {}", url));
    }

    println!("📨 [fetcher] Sending HTTP request...");

    let response = match HTTP_CLIENT
        .get(url)
        .header("Accept", "text/html, text/markdown, text/plain, application/json, */*")
        .header("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return create_error_response(url, String::new(), format!("Failed to fetch URL: {}", e));
        }
    };

    println!("📥 [fetcher] Got response, status: {}", response.status());

    if !response.status().is_success() {
        return create_error_response(
            url,
            String::new(),
            format!("HTTP error: {}", response.status()),
        );
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let mime_type = content_type.split(';').next().unwrap_or("").trim().to_string();

    let body = match response.text().await {
        Ok(c) => c,
        Err(e) => {
            return create_error_response(
                url,
                mime_type,
                format!("Failed to read response body: {}", e),
            );
        }
    };

    // Handle different content types
    match mime_type.clone().as_str() {
        // HTML content - use Readability algorithm for extraction
        "text/html" | "application/xhtml+xml" => {
            process_html_with_readability(url, &body, mime_type, max_chars)
        }

        // Markdown - return directly
        "text/markdown" | "text/x-markdown" => {
            process_text_content(url, &body, "text/markdown".to_string(), max_chars)
        }

        // Plain text - return directly
        "text/plain" => process_text_content(url, &body, mime_type, max_chars),

        // JSON - format as code block
        "application/json" => process_json_content(url, &body, max_chars),

        // XML - treat as text with code block
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
                },
            }
        }

        // Unsupported binary types
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
                process_html_with_readability(url, &body, "text/html".to_string(), max_chars)
            } else {
                // Treat as plain text
                process_text_content(url, &body, mime_type, max_chars)
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

/// Process multiple URLs in parallel
pub async fn process_message_urls(
    content: &str,
    max_chars: Option<usize>,
) -> Vec<FetchedWebResource> {
    let urls = extract_urls(content);

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
                resource.extraction_error.as_deref().unwrap_or("Unknown error")
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
}
