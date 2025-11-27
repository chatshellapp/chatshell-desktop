use anyhow::Result;
use chrono::Utc;
use lazy_static::lazy_static;
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::models::WebFetchMetadata;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchedWebResource {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub mime_type: String,
    pub content_format: String,     // MIME type of converted content (e.g., "text/markdown")
    pub content: String,
    pub extraction_error: Option<String>,
    pub metadata: WebFetchMetadata,
}

lazy_static! {
    static ref SCRIPT_REGEX: Regex = Regex::new(r"(?s)<script[^>]*>.*?</script>")
        .expect("Invalid script regex pattern");
    static ref STYLE_REGEX: Regex = Regex::new(r"(?s)<style[^>]*>.*?</style>")
        .expect("Invalid style regex pattern");
    static ref NAV_REGEX: Regex = Regex::new(r"(?s)<nav[^>]*>.*?</nav>")
        .expect("Invalid nav regex pattern");
    static ref HEADER_REGEX: Regex = Regex::new(r"(?s)<header[^>]*>.*?</header>")
        .expect("Invalid header regex pattern");
    static ref FOOTER_REGEX: Regex = Regex::new(r"(?s)<footer[^>]*>.*?</footer>")
        .expect("Invalid footer regex pattern");
    static ref ASIDE_REGEX: Regex = Regex::new(r"(?s)<aside[^>]*>.*?</aside>")
        .expect("Invalid aside regex pattern");
    static ref URL_REGEX: Regex = Regex::new(
        r"https?://(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&/=]*)"
    ).expect("Invalid URL regex pattern");
}

fn clean_html(html: &str) -> String {
    let document = Html::parse_document(html);
    
    let main_content_selectors = vec![
        "main",
        "article",
        "[role='main']",
        "#main-content",
        "#content",
        ".content",
        ".main-content",
        "#main",
        ".article-content",
        ".post-content",
        ".markdown-body",
    ];
    
    for selector_str in main_content_selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(main_element) = document.select(&selector).next() {
                return main_element.html();
            }
        }
    }
    
    let mut cleaned = html.to_string();
    cleaned = SCRIPT_REGEX.replace_all(&cleaned, "").to_string();
    cleaned = STYLE_REGEX.replace_all(&cleaned, "").to_string();
    cleaned = NAV_REGEX.replace_all(&cleaned, "").to_string();
    cleaned = HEADER_REGEX.replace_all(&cleaned, "").to_string();
    cleaned = FOOTER_REGEX.replace_all(&cleaned, "").to_string();
    cleaned = ASIDE_REGEX.replace_all(&cleaned, "").to_string();
    
    cleaned
}

pub fn extract_urls(text: &str) -> Vec<String> {
    URL_REGEX
        .find_iter(text)
        .map(|m| m.as_str().to_string())
        .collect()
}

fn extract_title(document: &Html) -> Option<String> {
    Selector::parse("title")
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_meta_description(document: &Html) -> Option<String> {
    Selector::parse(r#"meta[name="description"]"#)
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

/// Fetch and parse a web resource. max_chars: None = no truncation, Some(n) = truncate to n characters
pub async fn fetch_web_resource(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    println!("📡 [fetcher] Starting fetch for: {}", url);
    
    let client = match Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (compatible; ChatShell/1.0)")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return FetchedWebResource {
                url: url.to_string(),
                title: None,
                description: None,
                mime_type: String::new(),
                content_format: String::new(),
                content: String::new(),
                extraction_error: Some(format!("Failed to create HTTP client: {}", e)),
                metadata: WebFetchMetadata {
                    keywords: None,
                    headings: vec![],
                    fetched_at: Utc::now().to_rfc3339(),
                    original_length: None,
                    truncated: false,
                },
            };
        }
    };

    println!("📨 [fetcher] Sending HTTP request...");
    
    let response = match client
        .get(url)
        .header("Accept", "text/markdown, text/html, */*")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return FetchedWebResource {
                url: url.to_string(),
                title: None,
                description: None,
                mime_type: String::new(),
                content_format: String::new(),
                content: String::new(),
                extraction_error: Some(format!("Failed to fetch URL: {}", e)),
                metadata: WebFetchMetadata {
                    keywords: None,
                    headings: vec![],
                    fetched_at: Utc::now().to_rfc3339(),
                    original_length: None,
                    truncated: false,
                },
            };
        }
    };

    println!("📥 [fetcher] Got response, status: {}", response.status());

    if !response.status().is_success() {
        return FetchedWebResource {
            url: url.to_string(),
            title: None,
            description: None,
            mime_type: String::new(),
            content_format: String::new(),
            content: String::new(),
            extraction_error: Some(format!("HTTP error: {}", response.status())),
            metadata: WebFetchMetadata {
                keywords: None,
                headings: vec![],
                fetched_at: Utc::now().to_rfc3339(),
                original_length: None,
                truncated: false,
            },
        };
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let mime_type = content_type.split(';').next().unwrap_or("").trim().to_string();

    let html_content = match response.text().await {
        Ok(c) => c,
        Err(e) => {
            return FetchedWebResource {
                url: url.to_string(),
                title: None,
                description: None,
                mime_type: mime_type.clone(),
                content_format: mime_type,
                content: String::new(),
                extraction_error: Some(format!("Failed to read response body: {}", e)),
                metadata: WebFetchMetadata {
                    keywords: None,
                    headings: vec![],
                    fetched_at: Utc::now().to_rfc3339(),
                    original_length: None,
                    truncated: false,
                },
            };
        }
    };

    let document = Html::parse_document(&html_content);
    let title = extract_title(&document);
    let description = extract_meta_description(&document);
    let keywords = extract_meta_keywords(&document);
    let headings = extract_headings(&document);

    let cleaned_html = clean_html(&html_content);
    let markdown = html2md::parse_html(&cleaned_html);
    let original_length = markdown.chars().count();

    let (extracted_content, truncated) = match max_chars {
        Some(limit) => truncate_by_chars(&markdown, limit),
        None => (markdown, false),
    };

    let cleaned_content = extracted_content
        .lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n");

    FetchedWebResource {
        url: url.to_string(),
        title,
        description,
        mime_type,
        content_format: "text/markdown".to_string(), // Converted to markdown
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

pub async fn fetch_and_convert_to_markdown(url: &str, max_chars: Option<usize>) -> Result<String> {
    let result = fetch_web_resource(url, max_chars).await;
    if let Some(error) = result.extraction_error {
        return Err(anyhow::anyhow!("{}", error));
    }
    Ok(result.content)
}

pub async fn process_message_urls(content: &str, max_chars: Option<usize>) -> Vec<FetchedWebResource> {
    let urls = extract_urls(content);
    
    if urls.is_empty() {
        return vec![];
    }
    
    println!("🌐 [fetcher] Processing {} URLs", urls.len());
    let mut results = Vec::new();
    
    for url in &urls {
        println!("🔗 [fetcher] Fetching: {}", url);
        let fetched = fetch_web_resource(url, max_chars).await;
        println!("✅ [fetcher] Completed: {} (error: {:?})", url, fetched.extraction_error);
        results.push(fetched);
    }
    
    println!("📦 [fetcher] All URLs processed");
    results
}

pub fn build_llm_content_with_attachments(original_content: &str, fetched_resources: &[FetchedWebResource]) -> String {
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
        assert_eq!(urls[0], "https://example.com");
        assert_eq!(urls[1], "http://test.org/path?query=1");
    }

    #[test]
    fn test_no_urls() {
        let text = "This is a message without any URLs";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 0);
    }
}
