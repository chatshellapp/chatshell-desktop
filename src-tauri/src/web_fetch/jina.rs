use chrono::Utc;

use super::extractors::extract_favicon_url;
use super::types::{FetchedWebResource, WebFetchMetadata, HTTP_CLIENT};

const JINA_READER_BASE_URL: &str = "https://r.jina.ai/";

/// Fetch webpage content using Jina Reader API
pub async fn fetch_with_jina(url: &str, api_key: Option<&str>) -> FetchedWebResource {
    println!("📡 [jina] Fetching via Jina Reader: {}", url);

    let jina_url = format!("{}{}", JINA_READER_BASE_URL, url);

    let mut request = HTTP_CLIENT.get(&jina_url).header("Accept", "text/markdown");

    // Add API key if provided (optional - Jina works without it)
    if let Some(key) = api_key {
        if !key.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", key));
        }
    }

    match request.send().await {
        Ok(response) => {
            if !response.status().is_success() {
                println!(
                    "❌ [jina] Jina Reader returned status: {}",
                    response.status()
                );
                return FetchedWebResource::error(
                    url,
                    String::new(),
                    format!("Jina Reader returned status: {}", response.status()),
                    None,
                );
            }

            match response.text().await {
                Ok(content) => {
                    println!(
                        "✅ [jina] Successfully fetched {} bytes from Jina",
                        content.len()
                    );

                    let title = extract_title_from_markdown(&content);
                    let favicon_url = extract_favicon_url(url, None);

                    FetchedWebResource {
                        url: url.to_string(),
                        title,
                        description: None,
                        mime_type: "text/html".to_string(), // Original content type
                        content_format: "text/markdown".to_string(),
                        content,
                        extraction_error: None,
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
                Err(e) => {
                    println!("❌ [jina] Failed to read Jina response: {}", e);
                    FetchedWebResource::error(
                        url,
                        String::new(),
                        format!("Failed to read Jina response: {}", e),
                        None,
                    )
                }
            }
        }
        Err(e) => {
            println!("❌ [jina] Jina Reader request failed: {}", e);
            FetchedWebResource::error(
                url,
                String::new(),
                format!("Jina Reader request failed: {}", e),
                None,
            )
        }
    }
}

/// Extract title from markdown content (first # heading)
fn extract_title_from_markdown(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") {
            return Some(trimmed[2..].trim().to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_title_from_markdown() {
        let content = "# Hello World\n\nSome content here";
        assert_eq!(
            extract_title_from_markdown(content),
            Some("Hello World".to_string())
        );
    }

    #[test]
    fn test_extract_title_from_markdown_with_leading_whitespace() {
        let content = "  # Title with spaces  \n\nContent";
        assert_eq!(
            extract_title_from_markdown(content),
            Some("Title with spaces".to_string())
        );
    }

    #[test]
    fn test_extract_title_from_markdown_no_title() {
        let content = "No title here\n## This is h2";
        assert_eq!(extract_title_from_markdown(content), None);
    }
}

