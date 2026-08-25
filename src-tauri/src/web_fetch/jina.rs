use chrono::Utc;

use chatshell_agent_core::web_fetch as core_fetch;

use super::extractors::extract_favicon_url;
use super::types::{FetchedWebResource, WebFetchMetadata};

/// Fetch webpage content using the Jina Reader API.
///
/// The request/response handling is the shared core implementation
/// (`core_fetch::fetch_jina`); desktop adapts the result into its richer
/// `FetchedWebResource` (favicon metadata, content format bookkeeping).
pub async fn fetch_with_jina(url: &str, api_key: Option<&str>) -> FetchedWebResource {
    tracing::info!("📡 [jina] Fetching via Jina Reader: {}", url);

    let resource = core_fetch::fetch_jina(url, api_key).await;

    if let Some(error) = resource.extraction_error.as_deref() {
        tracing::info!("❌ [jina] Jina Reader failed: {}", error);
        return FetchedWebResource::error(url, String::new(), error.to_string(), None);
    }

    tracing::info!(
        "✅ [jina] Successfully fetched {} bytes from Jina",
        resource.content.len()
    );

    let favicon_url = extract_favicon_url(url, None);

    FetchedWebResource {
        url: resource.url,
        title: resource.title,
        description: resource.description,
        mime_type: "text/html".to_string(), // Original content type
        content_format: "text/markdown".to_string(),
        content: resource.content,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_title_from_markdown() {
        assert_eq!(
            core_fetch::extract_title_from_markdown("# Title\n\nSome content").as_deref(),
            Some("Title")
        );
    }

    #[test]
    fn test_extract_title_from_markdown_no_title() {
        assert_eq!(
            core_fetch::extract_title_from_markdown("No heading here"),
            None
        );
    }
}
