use futures::stream::{FuturesUnordered, StreamExt};
use tokio::sync::mpsc;
use url::Url;

use super::extractors::extract_favicon_url;
use super::headless::fetch_with_headless_fallback;
use super::jina::fetch_with_jina;
use super::obscura;
use super::processors::{
    process_browser_html, process_html_with_readability, process_json_content,
    process_text_content, process_xml_content,
};
use super::spa_detect::{has_low_quality_text, looks_like_js_shell};
use super::types::{FetchedWebResource, HTTP_CLIENT};
use super::webview_fetch;

use chatshell_agent_core::web_fetch::decode_body_bytes;

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
    /// HTTP first, then the full browser chain.
    #[default]
    Auto,
    /// Plain HTTP only, no browser fallback.
    FetchOnly,
    /// Skip plain HTTP; Obscura first (offered in settings only when the
    /// binary is installed), degrading through WebView to Chrome.
    ObscuraOnly,
    /// Skip plain HTTP and Obscura; system WebView first, degrading to
    /// headless Chrome.
    WebViewOnly,
    /// Headless Chrome directly (the classic heavy-weight path).
    ChromeOnly,
}

/// Configuration for web fetching
#[derive(Debug, Clone, Default)]
pub struct FetchConfig {
    pub mode: FetchMode,
    pub local_method: LocalMethod,
    pub jina_api_key: Option<String>,
}

/// Hard cap for a single remote source handed to an agent tool. Bounded by
/// the read tool's URL fetcher; web_fetch itself no longer downloads image
/// bodies.
pub(crate) const MAX_REMOTE_SOURCE_BYTES: usize = 20 * 1024 * 1024;

/// Fetch and parse a web resource using Mozilla's Readability algorithm for HTML.
/// max_chars: None = no truncation, Some(n) = truncate to n characters
/// Falls back to the browser tier (Obscura when configured, then the system
/// WebView, then headless Chrome) when direct HTTP fails with a network error
/// or non-2xx status, or when a 200 HTML response shows JS-shell signals
/// (see `spa_detect`).
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
            return fetch_with_browser_tier(url, max_chars).await;
        }
    };

    tracing::info!("📥 [fetcher] Got response, status: {}", response.status());

    // If non-200 status, try headless browser fallback
    if !response.status().is_success() {
        tracing::info!(
            "⚠️ [fetcher] HTTP error {}, trying headless browser fallback...",
            response.status()
        );
        return fetch_with_browser_tier(url, max_chars).await;
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

    // Direct images are not downloaded; the read tool fetches image URLs
    // through its own in-memory path. Drop the body without reading it.
    if mime_type.starts_with("image/") {
        return FetchedWebResource::image(url, mime_type);
    }

    let raw = match response.bytes().await {
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
    let body = decode_body_bytes(&raw, &content_type);

    // Handle different content types
    match mime_type.clone().as_str() {
        // HTML content - use Readability algorithm for extraction
        "text/html" | "application/xhtml+xml" => {
            // Extract favicon from HTML content
            let favicon_url = extract_favicon_url(url, Some(&body));
            let resource =
                process_html_with_readability(url, &body, mime_type, max_chars, favicon_url);
            escalate_if_js_shell(url, &body, max_chars, resource).await
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
                escalate_if_js_shell(
                    url,
                    &body,
                    max_chars,
                    process_html_with_readability(
                        url,
                        &body,
                        "text/html".to_string(),
                        max_chars,
                        favicon_url,
                    ),
                )
                .await
            } else {
                // Treat as plain text (no favicon for non-HTML)
                process_text_content(url, &body, mime_type, max_chars, None)
            }
        }
    }
}

/// Third fallback trigger: a 200 HTML response whose structure says the real
/// content is built client-side, or whose extracted text reads like a JS-gate
/// page or navigation shell (output-content checks; see `spa_detect`).
/// Re-fetches through the browser tier; keeps the HTTP result if every
/// browser tier fails (partial content beats an error). Only called from the
/// HTTP-success path, so there is no retry loop.
async fn escalate_if_js_shell(
    url: &str,
    body: &str,
    max_chars: Option<usize>,
    http_result: FetchedWebResource,
) -> FetchedWebResource {
    let extracted_chars = http_result.metadata.original_length.unwrap_or(0);
    if http_result.extraction_error.is_some()
        || (!looks_like_js_shell(body, extracted_chars)
            && !has_low_quality_text(&http_result.content))
    {
        return http_result;
    }
    tracing::info!(
        "🔄 [fetcher] JS-shell signals (extracted {} chars), escalating to browser tier: {}",
        extracted_chars,
        url
    );
    let browser_result = fetch_with_browser_tier(url, max_chars).await;
    if browser_result.extraction_error.is_none() {
        return browser_result;
    }
    tracing::warn!(
        "⚠️ [fetcher] Browser escalation failed ({}), keeping HTTP result for: {}",
        browser_result.extraction_error.unwrap_or_default(),
        url
    );
    http_result
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
            LocalMethod::ObscuraOnly => fetch_with_browser_tier(url, max_chars).await,
            LocalMethod::WebViewOnly => fetch_with_webview_tier(url, max_chars).await,
            LocalMethod::ChromeOnly => fetch_with_headless_fallback(url, max_chars).await,
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

    // Direct images are not downloaded; steer to the read tool instead.
    if mime_type.starts_with("image/") {
        return FetchedWebResource::image(url, mime_type);
    }

    let raw = match response.bytes().await {
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
    let body = decode_body_bytes(&raw, &content_type);

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

/// One obscura attempt; `None` means unavailable or failed, continue the chain.
async fn try_obscura(url: &str, max_chars: Option<usize>) -> Option<FetchedWebResource> {
    if !obscura::is_configured() {
        return None;
    }
    tracing::info!("🔄 [fetcher] Trying obscura browser tier for: {}", url);
    match obscura::fetch_html(url).await {
        Ok(html) => Some(process_browser_html(url, &html, max_chars)),
        Err(e) => {
            tracing::warn!("⚠️ [fetcher] Obscura fetch failed: {}", e);
            None
        }
    }
}

/// One system-WebView attempt; `None` means unavailable or failed.
async fn try_webview(url: &str, max_chars: Option<usize>) -> Option<FetchedWebResource> {
    if !webview_fetch::is_available() {
        return None;
    }
    tracing::info!("🔄 [fetcher] Trying system webview tier for: {}", url);
    match webview_fetch::fetch_html(url).await {
        Ok(html) => Some(process_browser_html(url, &html, max_chars)),
        Err(e) => {
            tracing::warn!("⚠️ [fetcher] System webview fetch failed: {}", e);
            None
        }
    }
}

/// Full browser chain: Obscura (when installed) → system WebView → headless
/// Chrome. The Auto-mode fallback and the ObscuraOnly local method.
async fn fetch_with_browser_tier(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    if let Some(res) = try_obscura(url, max_chars).await {
        return res;
    }
    fetch_with_webview_tier(url, max_chars).await
}

/// System WebView first, degrading to headless Chrome.
async fn fetch_with_webview_tier(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    if let Some(res) = try_webview(url, max_chars).await {
        return res;
    }
    fetch_with_headless_fallback(url, max_chars).await
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
#[allow(dead_code)]
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
