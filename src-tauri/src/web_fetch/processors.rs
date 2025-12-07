use chrono::Utc;
use readability::extractor::extract;
use scraper::{Html, Selector};
use std::io::Cursor;
use url::Url;

use super::extractors::{
    extract_headings, extract_meta_description, extract_meta_keywords, normalize_html_images,
    truncate_by_chars,
};
use super::types::{FetchedWebResource, WebFetchMetadata};

/// Process HTML content using Mozilla's Readability algorithm and convert to markdown
pub fn process_html_with_readability(
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
            return FetchedWebResource::error(
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
    let markdown = htmd::convert(&normalized_html).unwrap_or_default();
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
pub fn process_text_content(
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
pub fn process_json_content(
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

/// Process XML content (format as code block)
pub fn process_xml_content(
    url: &str,
    xml_content: &str,
    mime_type: String,
    max_chars: Option<usize>,
) -> FetchedWebResource {
    let markdown_content = format!("```xml\n{}\n```", xml_content);
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

