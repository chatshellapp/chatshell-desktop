use anyhow::Result;
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use std::time::Duration;

/// Clean HTML content by removing unnecessary elements and extracting main content
fn clean_html(html: &str) -> String {
    let document = Html::parse_document(html);
    
    // Try to find main content area with common selectors
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
    
    // Try each selector to find main content
    for selector_str in main_content_selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(main_element) = document.select(&selector).next() {
                // Found main content, use it
                return main_element.html();
            }
        }
    }
    
    // If no main content found, use regex to remove common unwanted elements
    let mut cleaned = html.to_string();
    
    // Remove script tags with content
    let script_regex = Regex::new(r"(?s)<script[^>]*>.*?</script>").unwrap();
    cleaned = script_regex.replace_all(&cleaned, "").to_string();
    
    // Remove style tags with content
    let style_regex = Regex::new(r"(?s)<style[^>]*>.*?</style>").unwrap();
    cleaned = style_regex.replace_all(&cleaned, "").to_string();
    
    // Remove nav tags
    let nav_regex = Regex::new(r"(?s)<nav[^>]*>.*?</nav>").unwrap();
    cleaned = nav_regex.replace_all(&cleaned, "").to_string();
    
    // Remove header tags
    let header_regex = Regex::new(r"(?s)<header[^>]*>.*?</header>").unwrap();
    cleaned = header_regex.replace_all(&cleaned, "").to_string();
    
    // Remove footer tags
    let footer_regex = Regex::new(r"(?s)<footer[^>]*>.*?</footer>").unwrap();
    cleaned = footer_regex.replace_all(&cleaned, "").to_string();
    
    // Remove aside tags
    let aside_regex = Regex::new(r"(?s)<aside[^>]*>.*?</aside>").unwrap();
    cleaned = aside_regex.replace_all(&cleaned, "").to_string();
    
    cleaned
}

/// Extract URLs from text
pub fn extract_urls(text: &str) -> Vec<String> {
    let url_regex = Regex::new(
        r"https?://(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&/=]*)"
    ).unwrap();
    
    url_regex
        .find_iter(text)
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Fetch webpage content and convert to markdown
pub async fn fetch_and_convert_to_markdown(url: &str) -> Result<String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (compatible; ChatShell/1.0)")
        .build()?;
    
    // Send Accept header with preferred content types in order
    // text/plain, text/markdown, text/html, application/xhtml+xml, then any
    let response = client
        .get(url)
        .header("Accept", "text/plain, text/markdown, text/html, application/xhtml+xml, */*;q=0.8")
        .send()
        .await?;
    
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to fetch URL: {}", response.status()));
    }
    
    // Check Content-Type and handle accordingly
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    
    let content = response.text().await?;
    
    // Handle different content types based on Accept header preferences
    let markdown = if content_type.contains("text/plain") {
        // Plain text - return as-is
        content
    } else if content_type.contains("text/markdown") {
        // Markdown - return as-is
        content
    } else if content_type.contains("application/json") || content_type.contains("text/json") {
        // JSON - return as-is with code block formatting
        format!("```json\n{}\n```", content)
    } else if content_type.contains("application/xml") 
        || content_type.contains("text/xml") 
        || content_type.contains("application/rss+xml")
        || content_type.contains("application/atom+xml") {
        // XML - return as-is with code block formatting
        format!("```xml\n{}\n```", content)
    } else if content_type.contains("text/html") || content_type.contains("application/xhtml") {
        // HTML - convert to markdown
        
        // Basic HTML detection
        let html_lower = content.trim_start().to_lowercase();
        if !html_lower.starts_with("<!doctype") 
            && !html_lower.starts_with("<html") 
            && !html_lower.starts_with("<?xml") {
            return Err(anyhow::anyhow!("Content does not appear to be valid HTML"));
        }
        
        // Clean HTML to extract main content and remove unnecessary elements
        let cleaned_html = clean_html(&content);
        
        // Convert to markdown
        html2md::parse_html(&cleaned_html)
    } else if !content_type.is_empty() {
        // Unsupported content type
        return Err(anyhow::anyhow!(
            "URL returns {} content. Only text, markdown, HTML, JSON, or XML content can be processed.",
            content_type.split(';').next().unwrap_or("unknown")
        ));
    } else {
        // No content-type, try to detect and process as HTML
        let content_lower = content.trim_start().to_lowercase();
        if content_lower.starts_with("<!doctype") 
            || content_lower.starts_with("<html") 
            || content_lower.starts_with("<?xml") {
            // Looks like HTML
            let cleaned_html = clean_html(&content);
            html2md::parse_html(&cleaned_html)
        } else {
            // Treat as plain text
            content
        }
    };
    
    // Limit the content length to avoid overwhelming the AI
    const MAX_LENGTH: usize = 8000; // characters
    let trimmed = if markdown.len() > MAX_LENGTH {
        let truncated = &markdown[..MAX_LENGTH];
        format!("{}\n\n[Content truncated - original length: {} characters]", truncated, markdown.len())
    } else {
        markdown
    };
    
    // Clean up excessive whitespace
    let cleaned = trimmed
        .lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    
    Ok(cleaned)
}

/// Process message content and fetch URLs
/// Returns (processed_content_for_llm, scraped_content_only)
pub async fn process_message_with_urls(content: &str) -> Result<(String, String)> {
    let urls = extract_urls(content);
    
    if urls.is_empty() {
        return Ok((content.to_string(), String::new()));
    }
    
    let mut processed_content = content.to_string();
    let mut scraped_only = String::new();
    
    for url in urls {
        match fetch_and_convert_to_markdown(&url).await {
            Ok(markdown) => {
                // Add the scraped content after the original message
                let scraped_section = format!(
                    "\n\n---\n**Content from {}:**\n\n{}",
                    url,
                    markdown.trim()
                );
                processed_content.push_str(&scraped_section);
                scraped_only.push_str(&scraped_section);
            }
            Err(e) => {
                eprintln!("Failed to fetch {}: {}", url, e);
                // Add a note about the failure
                let error_note = format!(
                    "\n\n---\n**Note:** Could not fetch content from {}: {}",
                    url,
                    e
                );
                processed_content.push_str(&error_note);
                scraped_only.push_str(&error_note);
            }
        }
    }
    
    Ok((processed_content, scraped_only))
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

