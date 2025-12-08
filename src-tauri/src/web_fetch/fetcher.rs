use futures::stream::{FuturesUnordered, StreamExt};
use tokio::sync::mpsc;
use url::Url;

use super::extractors::extract_favicon_url;
use super::headless::{fetch_with_headless_browser, fetch_with_headless_fallback};
use super::jina::fetch_with_jina;
use super::processors::{
    process_html_with_readability, process_json_content, process_text_content, process_xml_content,
};
use super::types::{FetchedWebResource, HTTP_CLIENT};

/// Fetch mode from settings
#[derive(Debug, Clone, PartialEq, Default)]
pub enum FetchMode {
    #[default]
    Local,
    Api,
}

/// Local fetch method
#[derive(Debug, Clone, PartialEq, Default)]
pub enum LocalMethod {
    #[default]
    Auto,
    FetchOnly,
    HeadlessOnly,
}

/// Configuration for web fetching
#[derive(Debug, Clone, Default)]
pub struct FetchConfig {
    pub mode: FetchMode,
    pub local_method: LocalMethod,
    pub jina_api_key: Option<String>,
}

/// Fetch and parse a web resource using Mozilla's Readability algorithm for HTML.
/// max_chars: None = no truncation, Some(n) = truncate to n characters
/// Falls back to headless browser if direct HTTP fetch fails with non-200 status.
pub async fn fetch_web_resource(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    tracing::info!("📡 [fetcher] Starting fetch for: {}", url);

    // Validate URL first
    if Url::parse(url).is_err() {
        return FetchedWebResource::error(
            url,
            String::new(),
            format!("Invalid URL: {}", url),
            None,
        );
    }

    tracing::info!("📨 [fetcher] Sending HTTP request...");

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
            tracing::info!(
                "⚠️ [fetcher] HTTP request failed: {}, trying headless browser...",
                e
            );
            return fetch_with_headless_fallback(url, max_chars).await;
        }
    };

    tracing::info!("📥 [fetcher] Got response, status: {}", response.status());

    // If non-200 status, try headless browser fallback
    if !response.status().is_success() {
        tracing::info!(
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
            return FetchedWebResource::error(
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
        "application/xml" | "text/xml" => process_xml_content(url, &body, mime_type, max_chars),

        // Unsupported binary types (no favicon for binary content)
        mime if mime.starts_with("image/")
            || mime.starts_with("audio/")
            || mime.starts_with("video/")
            || mime == "application/pdf"
            || mime == "application/octet-stream" =>
        {
            FetchedWebResource::error(
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

/// Fetch web resource with configuration
pub async fn fetch_web_resource_with_config(
    url: &str,
    max_chars: Option<usize>,
    config: &FetchConfig,
) -> FetchedWebResource {
    match config.mode {
        FetchMode::Api => fetch_with_jina(url, config.jina_api_key.as_deref()).await,
        FetchMode::Local => match config.local_method {
            LocalMethod::Auto => fetch_web_resource(url, max_chars).await,
            LocalMethod::FetchOnly => fetch_with_http_only(url, max_chars).await,
            LocalMethod::HeadlessOnly => fetch_with_headless_only(url, max_chars).await,
        },
    }
}

/// Fetch using HTTP only (no headless fallback)
async fn fetch_with_http_only(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    tracing::info!("📡 [fetcher] Starting HTTP-only fetch for: {}", url);

    // Validate URL first
    if Url::parse(url).is_err() {
        return FetchedWebResource::error(
            url,
            String::new(),
            format!("Invalid URL: {}", url),
            None,
        );
    }

    let response = match HTTP_CLIENT
        .get(url)
        .header("Accept", "text/markdown, text/html, */*")
        .header("Accept-Encoding", "gzip, deflate, br, zstd")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return FetchedWebResource::error(
                url,
                String::new(),
                format!("HTTP request failed: {}", e),
                None,
            );
        }
    };

    if !response.status().is_success() {
        return FetchedWebResource::error(
            url,
            String::new(),
            format!("HTTP error: {}", response.status()),
            None,
        );
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
            return FetchedWebResource::error(
                url,
                mime_type,
                format!("Failed to read response body: {}", e),
                None,
            );
        }
    };

    // Handle different content types (same as fetch_web_resource)
    match mime_type.clone().as_str() {
        "text/html" | "application/xhtml+xml" => {
            let favicon_url = extract_favicon_url(url, Some(&body));
            process_html_with_readability(url, &body, mime_type, max_chars, favicon_url)
        }
        "text/markdown" | "text/x-markdown" => {
            process_text_content(url, &body, "text/markdown".to_string(), max_chars, None)
        }
        "text/plain" => process_text_content(url, &body, mime_type, max_chars, None),
        "application/json" => process_json_content(url, &body, max_chars, None),
        "application/xml" | "text/xml" => process_xml_content(url, &body, mime_type, max_chars),
        mime if mime.starts_with("image/")
            || mime.starts_with("audio/")
            || mime.starts_with("video/")
            || mime == "application/pdf"
            || mime == "application/octet-stream" =>
        {
            FetchedWebResource::error(
                url,
                mime_type,
                format!(
                    "Unsupported content type: {}. Binary content cannot be processed.",
                    mime
                ),
                None,
            )
        }
        _ => {
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
                process_text_content(url, &body, mime_type, max_chars, None)
            }
        }
    }
}

/// Fetch using headless Chrome only
async fn fetch_with_headless_only(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    tracing::info!("📡 [fetcher] Starting headless Chrome fetch for: {}", url);

    // Validate URL first
    if Url::parse(url).is_err() {
        return FetchedWebResource::error(
            url,
            String::new(),
            format!("Invalid URL: {}", url),
            None,
        );
    }

    // Run headless browser in blocking thread
    let url_owned = url.to_string();
    let html_result =
        tokio::task::spawn_blocking(move || fetch_with_headless_browser(&url_owned)).await;

    match html_result {
        Ok(Ok(html)) => {
            let favicon_url = extract_favicon_url(url, Some(&html));
            process_html_with_readability(
                url,
                &html,
                "text/html".to_string(),
                max_chars,
                favicon_url,
            )
        }
        Ok(Err(e)) => FetchedWebResource::error(
            url,
            String::new(),
            format!("Headless browser fetch failed: {}", e),
            None,
        ),
        Err(e) => FetchedWebResource::error(
            url,
            String::new(),
            format!("Headless browser task failed: {}", e),
            None,
        ),
    }
}

/// Fetch multiple URLs in parallel with configuration
pub async fn fetch_urls_with_config(
    urls: &[String],
    max_chars: Option<usize>,
    config: FetchConfig,
) -> (
    mpsc::Receiver<FetchedWebResource>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, rx) = mpsc::channel(urls.len().max(1));

    if urls.is_empty() {
        drop(tx);
        return (rx, tokio::spawn(async {}));
    }

    tracing::info!(
        "🌐 [fetcher] Processing {} URLs in parallel with config (streaming)",
        urls.len()
    );

    let urls_owned: Vec<String> = urls.to_vec();

    let handle = tokio::spawn(async move {
        let mut futures: FuturesUnordered<_> = urls_owned
            .iter()
            .map(|url| {
                let url = url.clone();
                let cfg = config.clone();
                async move {
                    tracing::info!("🔗 [fetcher] Fetching with config: {}", url);
                    let result = fetch_web_resource_with_config(&url, max_chars, &cfg).await;
                    tracing::info!(
                        "✅ [fetcher] Completed: {} (error: {:?})",
                        url,
                        result.extraction_error
                    );
                    result
                }
            })
            .collect();

        while let Some(result) = futures.next().await {
            if tx.send(result).await.is_err() {
                break; // Receiver dropped
            }
        }

        tracing::info!("📦 [fetcher] All URLs processed with config (streaming)");
    });

    (rx, handle)
}

/// Fetch multiple URLs in parallel, sending results through a channel as they complete.
/// Returns a receiver for streaming results and a join handle for the fetch task.
/// Results are sent one by one as each URL completes, enabling real-time UI updates.
pub async fn fetch_urls_with_channel(
    urls: &[String],
    max_chars: Option<usize>,
) -> (
    mpsc::Receiver<FetchedWebResource>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, rx) = mpsc::channel(urls.len().max(1));

    if urls.is_empty() {
        drop(tx);
        return (rx, tokio::spawn(async {}));
    }

    tracing::info!(
        "🌐 [fetcher] Processing {} URLs in parallel (streaming)",
        urls.len()
    );

    let urls_owned: Vec<String> = urls.to_vec();

    let handle = tokio::spawn(async move {
        let mut futures: FuturesUnordered<_> = urls_owned
            .iter()
            .map(|url| {
                let url = url.clone();
                async move {
                    tracing::info!("🔗 [fetcher] Fetching: {}", url);
                    let result = fetch_web_resource(&url, max_chars).await;
                    tracing::info!(
                        "✅ [fetcher] Completed: {} (error: {:?})",
                        url,
                        result.extraction_error
                    );
                    result
                }
            })
            .collect();

        while let Some(result) = futures.next().await {
            if tx.send(result).await.is_err() {
                break; // Receiver dropped
            }
        }

        tracing::info!("📦 [fetcher] All URLs processed (streaming)");
    });

    (rx, handle)
}

/// Build LLM content with fetched web resources as attachments
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
