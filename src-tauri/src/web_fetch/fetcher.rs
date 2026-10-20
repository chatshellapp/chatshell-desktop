use chrono::Utc;
use futures::stream::{FuturesUnordered, StreamExt};
use tokio::sync::mpsc;
use url::Url;

use super::extractors::{extract_favicon_url, truncate_by_chars};
use super::headless::fetch_with_headless_fallback;
use super::jina::fetch_with_jina;
use super::obscura;
use super::processors::{
    process_browser_html, process_html_with_readability, process_json_content,
    process_text_content, process_xml_content,
};
use super::spa_detect::{has_low_quality_text, looks_like_js_shell};
use super::types::{FetchedWebResource, HTTP_CLIENT, WebFetchMetadata};
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
                process_html_with_readability(url, &body, mime_type, max_chars, favicon_url)
                    .with_tier("http");
            escalate_if_js_shell(url, &body, max_chars, resource).await
        }

        // Markdown - return directly (no favicon for non-HTML)
        "text/markdown" | "text/x-markdown" => {
            process_text_content(url, &body, "text/markdown".to_string(), max_chars, None)
                .with_tier("http")
        }

        // Plain text - return directly (no favicon for non-HTML)
        "text/plain" => {
            process_text_content(url, &body, mime_type, max_chars, None).with_tier("http")
        }

        // JSON - format as code block (no favicon for non-HTML)
        "application/json" => process_json_content(url, &body, max_chars, None).with_tier("http"),

        // XML - treat as text with code block (no favicon for non-HTML)
        "application/xml" | "text/xml" => {
            process_xml_content(url, &body, mime_type, max_chars).with_tier("http")
        }

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
                    )
                    .with_tier("http"),
                )
                .await
            } else {
                // Treat as plain text (no favicon for non-HTML)
                process_text_content(url, &body, mime_type, max_chars, None).with_tier("http")
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
        return browser_result.mark_escalated();
    }
    tracing::warn!(
        "⚠️ [fetcher] Browser escalation failed ({}), keeping HTTP result for: {}",
        browser_result.extraction_error.unwrap_or_default(),
        url
    );
    http_result.mark_partial()
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
    let resource = match mime_type.clone().as_str() {
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
    };

    resource.with_tier("http")
}

/// Plain HTTP with no extraction and no browser escalation. Returns the
/// response body as decoded text, capped by `max_chars`.
///
/// The escape hatch for the `web_fetch` tool's `raw` mode: readability can
/// pick the wrong container, and a browser-rendered page can differ from what
/// the server sent. This path reports exactly what HTTP returned.
pub async fn fetch_raw_http(url: &str, max_chars: Option<usize>) -> FetchedWebResource {
    tracing::info!("📡 [fetcher] Starting raw HTTP fetch for: {}", url);

    if Url::parse(url).is_err() {
        return FetchedWebResource::error(
            url,
            String::new(),
            format!("Invalid URL: {}", url),
            None,
        );
    }

    let response = match HTTP_CLIENT.get(url).header("Accept", "*/*").send().await {
        Ok(response) => response,
        Err(error) => {
            return FetchedWebResource::error(
                url,
                String::new(),
                format!("HTTP request failed: {}", error),
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
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let mime_type = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    // Direct images still belong to the read tool's in-memory path.
    if mime_type.starts_with("image/") {
        return FetchedWebResource::image(url, mime_type);
    }

    let raw = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            return FetchedWebResource::error(
                url,
                mime_type,
                format!("Failed to read response body: {}", error),
                None,
            );
        }
    };
    let body = decode_body_bytes(&raw, &content_type);
    let original_length = body.chars().count();
    let (content, truncated) = match max_chars {
        Some(limit) => truncate_by_chars(&body, limit),
        None => (body, false),
    };

    let content_format = if mime_type.is_empty() {
        "text/plain".to_string()
    } else {
        mime_type.clone()
    };

    FetchedWebResource {
        url: url.to_string(),
        title: None,
        description: None,
        mime_type,
        content_format,
        content,
        extraction_error: None,
        metadata: WebFetchMetadata {
            keywords: None,
            headings: vec![],
            fetched_at: Utc::now().to_rfc3339(),
            original_length: Some(original_length),
            truncated,
            favicon_url: None,
            tier: Some("http".to_string()),
            escalated: false,
            partial: false,
        },
    }
}

/// One obscura attempt; `None` means unavailable or failed, continue the chain.
async fn try_obscura(url: &str, max_chars: Option<usize>) -> Option<FetchedWebResource> {
    if !obscura::is_configured() {
        return None;
    }
    tracing::info!("🔄 [fetcher] Trying obscura browser tier for: {}", url);
    match obscura::fetch_html(url).await {
        Ok(html) => Some(process_browser_html(url, &html, max_chars).with_tier("obscura")),
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
        Ok(html) => Some(process_browser_html(url, &html, max_chars).with_tier("webview")),
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // ---- one-shot loopback HTTP helpers ----
    //
    // Same convention as the `web_fetch` tool tests: bind an ephemeral
    // 127.0.0.1 port, accept exactly one request, answer with a raw
    // HTTP/1.1 response, close.

    async fn serve_raw_response(
        status_line: &str,
        content_type: Option<&str>,
        body: Vec<u8>,
        declared_len: u64,
    ) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status_line = status_line.to_string();
        let content_type = content_type.map(str::to_string);
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let _ = socket.read(&mut request).await;
            let mut headers = format!(
                "HTTP/1.1 {}\r\nContent-Length: {}\r\nConnection: close\r\n",
                status_line, declared_len
            );
            if let Some(content_type) = content_type {
                headers.push_str(&format!("Content-Type: {}\r\n", content_type));
            }
            headers.push_str("\r\n");
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
        });
        format!("http://{}/resource", address)
    }

    async fn serve_one_response(content_type: &str, body: Vec<u8>, declared_len: u64) -> String {
        serve_raw_response("200 OK", Some(content_type), body, declared_len).await
    }

    /// Accept one connection, then close the socket without answering.
    async fn serve_immediate_close() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            drop(socket);
        });
        format!("http://{}/resource", address)
    }

    /// Loopback URL with nothing listening: connects are refused outright.
    fn dead_loopback_url() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{}/resource", address)
    }

    fn fetch_only_config() -> FetchConfig {
        FetchConfig {
            mode: FetchMode::Local,
            local_method: LocalMethod::FetchOnly,
            jina_api_key: None,
        }
    }

    /// Static, shell-free article page shared by the HTML-path tests.
    fn article_html() -> String {
        let paragraphs: String = (0..6)
            .map(|i| {
                format!(
                    "<p>Paragraph {i} of the brewing journal covers kettle souring and \
                     hop scheduling with repeatable, substantial detail for readability \
                     scoring.</p>\n"
                )
            })
            .collect();
        format!(
            "<!DOCTYPE html>\n<html>\n<head>\n<title>Modern Brewing Guide</title>\n\
             <meta name=\"description\" content=\"A test page description\">\n\
             <link rel=\"icon\" href=\"/favicon.ico\">\n</head>\n<body>\n\
             <article>\n<h1>Modern Brewing Guide</h1>\n{paragraphs}</article>\n\
             </body>\n</html>\n"
        )
    }

    // ---- fetch_raw_http ----

    #[tokio::test]
    async fn raw_http_returns_body_as_is_with_http_tier() {
        let body = b"hello raw body".to_vec();
        let url = serve_one_response("text/plain", body.clone(), body.len() as u64).await;

        let result = fetch_raw_http(&url, None).await;

        assert_eq!(result.extraction_error, None);
        assert_eq!(result.content, "hello raw body");
        assert_eq!(result.mime_type, "text/plain");
        assert_eq!(result.content_format, "text/plain");
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
        assert_eq!(result.metadata.original_length, Some(14));
        assert!(!result.metadata.truncated);
        assert!(!result.metadata.escalated);
        assert!(!result.metadata.partial);
    }

    #[tokio::test]
    async fn raw_http_truncates_by_chars_with_marker() {
        let body = b"hello world".to_vec();
        let url = serve_one_response("text/plain", body.clone(), body.len() as u64).await;

        let result = fetch_raw_http(&url, Some(5)).await;

        assert_eq!(
            result.content,
            "hello\n\n[Content truncated - original length: 11 characters]"
        );
        assert!(result.metadata.truncated);
        assert_eq!(result.metadata.original_length, Some(11));
    }

    #[tokio::test]
    async fn raw_http_defaults_missing_content_type_to_text_plain() {
        let body = b"no content type header".to_vec();
        let url = serve_raw_response("200 OK", None, body.clone(), body.len() as u64).await;

        let result = fetch_raw_http(&url, None).await;

        assert_eq!(result.mime_type, "");
        assert_eq!(result.content_format, "text/plain");
        assert_eq!(result.content, "no content type header");
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
    }

    #[tokio::test]
    async fn raw_http_maps_non_2xx_to_error_resource() {
        let body = b"missing".to_vec();
        let url = serve_raw_response(
            "404 Not Found",
            Some("text/plain"),
            body.clone(),
            body.len() as u64,
        )
        .await;

        let result = fetch_raw_http(&url, None).await;

        assert_eq!(
            result.extraction_error.as_deref(),
            Some("HTTP error: 404 Not Found")
        );
        assert_eq!(result.content, "");
        assert_eq!(result.metadata.tier, None);
        assert!(!result.metadata.escalated);
        assert!(!result.metadata.partial);
    }

    #[tokio::test]
    async fn raw_http_connection_refused_is_an_http_request_error() {
        let result = fetch_raw_http(&dead_loopback_url(), None).await;

        assert!(
            result
                .extraction_error
                .as_deref()
                .unwrap()
                .starts_with("HTTP request failed:")
        );
        assert_eq!(result.metadata.tier, None);
    }

    #[tokio::test]
    async fn raw_http_immediate_close_is_an_http_request_error() {
        let url = serve_immediate_close().await;

        let result = fetch_raw_http(&url, None).await;

        assert!(
            result
                .extraction_error
                .as_deref()
                .unwrap()
                .starts_with("HTTP request failed:")
        );
    }

    #[tokio::test]
    async fn raw_http_invalid_url_errors_before_any_request() {
        let result = fetch_raw_http("not a url", None).await;

        assert_eq!(
            result.extraction_error.as_deref(),
            Some("Invalid URL: not a url")
        );
    }

    // ---- fetch_web_resource_with_config (Local + FetchOnly) ----

    #[tokio::test]
    async fn fetch_only_extracts_html_with_readability_and_favicon() {
        let body = article_html().into_bytes();
        let url = serve_one_response("text/html", body.clone(), body.len() as u64).await;
        let expected_favicon = Url::parse(&url)
            .unwrap()
            .join("/favicon.ico")
            .unwrap()
            .to_string();

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        assert_eq!(result.extraction_error, None);
        assert_eq!(result.title.as_deref(), Some("Modern Brewing Guide"));
        assert_eq!(
            result.description.as_deref(),
            Some("A test page description")
        );
        assert_eq!(
            result.metadata.favicon_url.as_deref(),
            Some(expected_favicon.as_str())
        );
        assert_eq!(result.mime_type, "text/html");
        assert_eq!(result.content_format, "text/markdown");
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
        assert!(result.content.contains("kettle souring"));
        assert!(
            result
                .metadata
                .headings
                .iter()
                .any(|h| h.contains("Modern Brewing Guide"))
        );
        assert!(!result.metadata.escalated);
        assert!(!result.metadata.partial);
    }

    #[tokio::test]
    async fn fetch_only_passes_markdown_and_text_through() {
        let markdown = b"# Heading\n\nParagraph text.".to_vec();
        let url =
            serve_one_response("text/markdown", markdown.clone(), markdown.len() as u64).await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        assert_eq!(result.extraction_error, None);
        assert_eq!(result.content, "# Heading\n\nParagraph text.");
        assert_eq!(result.mime_type, "text/markdown");
        assert_eq!(result.content_format, "text/markdown");
        assert_eq!(result.title, None);
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));

        let text = b"plain text body".to_vec();
        let url = serve_one_response("text/plain", text.clone(), text.len() as u64).await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        assert_eq!(result.content, "plain text body");
        assert_eq!(result.mime_type, "text/plain");
        assert_eq!(result.content_format, "text/plain");
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
    }

    #[tokio::test]
    async fn fetch_only_formats_json_as_code_block() {
        let body = br#"{"a": 1}"#.to_vec();
        let url = serve_one_response("application/json", body.clone(), body.len() as u64).await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        let expected = "```json\n{\n  \"a\": 1\n}\n```";
        assert_eq!(result.extraction_error, None);
        assert_eq!(result.content, expected);
        assert_eq!(result.mime_type, "application/json");
        assert_eq!(result.content_format, "text/markdown");
        assert_eq!(result.description.as_deref(), Some("JSON data"));
        assert_eq!(
            result.metadata.original_length,
            Some(expected.chars().count())
        );
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
    }

    #[tokio::test]
    async fn fetch_only_formats_xml_as_code_block() {
        let body = b"<root><item>value</item></root>".to_vec();
        let url = serve_one_response("text/xml", body.clone(), body.len() as u64).await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        assert_eq!(
            result.content,
            "```xml\n<root><item>value</item></root>\n```"
        );
        assert_eq!(result.mime_type, "text/xml");
        assert_eq!(result.content_format, "text/markdown");
        assert_eq!(result.description.as_deref(), Some("XML data"));
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
    }

    #[tokio::test]
    async fn fetch_only_short_circuits_images_to_image_resource() {
        let body = b"\x89PNG-not-a-real-image".to_vec();
        let url = serve_one_response("image/png", body.clone(), body.len() as u64).await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        assert_eq!(result.extraction_error, None);
        assert_eq!(result.mime_type, "image/png");
        assert_eq!(result.content_format, "image/png");
        assert!(result.content.starts_with("This URL is a direct image"));
        assert_eq!(result.metadata.original_length, None);
        // The image path returns before the HTTP tier is tagged.
        assert_eq!(result.metadata.tier, None);
    }

    #[tokio::test]
    async fn fetch_only_rejects_octet_stream_as_binary() {
        let body = vec![0u8, 1, 2, 3];
        let url =
            serve_one_response("application/octet-stream", body.clone(), body.len() as u64).await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        assert_eq!(
            result.extraction_error.as_deref(),
            Some(
                "Unsupported content type: application/octet-stream. Binary content cannot be processed."
            )
        );
        assert_eq!(result.mime_type, "application/octet-stream");
        // The error is produced by the HTTP path itself, so it keeps the tier.
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
    }

    #[tokio::test]
    async fn fetch_only_routes_html_body_with_unknown_mime_through_readability() {
        let body = article_html().into_bytes();
        let url =
            serve_one_response("application/x-unknown", body.clone(), body.len() as u64).await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        assert_eq!(result.extraction_error, None);
        // The sniffed HTML path normalizes the mime type.
        assert_eq!(result.mime_type, "text/html");
        assert_eq!(result.content_format, "text/markdown");
        assert_eq!(result.title.as_deref(), Some("Modern Brewing Guide"));
        assert!(result.content.contains("kettle souring"));
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
    }

    #[tokio::test]
    async fn fetch_only_invalid_url_errors_without_a_request() {
        let result = fetch_web_resource_with_config("not a url", None, &fetch_only_config()).await;

        assert_eq!(
            result.extraction_error.as_deref(),
            Some("Invalid URL: not a url")
        );
        assert_eq!(result.mime_type, "");
        assert_eq!(result.metadata.tier, None);
    }

    #[tokio::test]
    async fn fetch_only_maps_non_2xx_to_error_resource() {
        let body = b"missing".to_vec();
        let url = serve_raw_response(
            "500 Internal Server Error",
            Some("text/plain"),
            body.clone(),
            body.len() as u64,
        )
        .await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        assert_eq!(
            result.extraction_error.as_deref(),
            Some("HTTP error: 500 Internal Server Error")
        );
        assert_eq!(result.metadata.tier, None);
    }

    #[tokio::test]
    async fn fetch_only_connection_refused_stays_a_plain_http_error() {
        let result =
            fetch_web_resource_with_config(&dead_loopback_url(), None, &fetch_only_config()).await;

        assert!(
            result
                .extraction_error
                .as_deref()
                .unwrap()
                .starts_with("HTTP request failed:")
        );
        // FetchOnly never escalates to a browser tier, unlike Auto.
        assert!(!result.metadata.escalated);
        assert!(!result.metadata.partial);
        assert_eq!(result.metadata.tier, None);
    }

    // ---- JS-shell escalation (offline-deterministic surface only) ----
    //
    // escalate_if_js_shell's escalation branch re-fetches through the
    // browser tier (obscura -> WebView -> headless Chrome). Developer
    // machines routinely have obscura on PATH and Chrome installed (this
    // one does), so the escalated outcome and even whether a tier engages
    // are machine-dependent. What is deterministic offline:
    // - both early-return predicates below, called directly;
    // - FetchOnly returning a JS-shell page unmarked (test further down);
    // - Auto keeping the HTTP result for healthy pages (dispatch test).

    #[test]
    fn webview_tier_cannot_engage_in_the_test_binary() {
        // set_app_handle runs only from the Tauri app setup in lib.rs.
        assert!(!webview_fetch::is_available());
    }

    #[tokio::test]
    async fn escalate_keeps_error_resources_without_escalating() {
        let url = "http://127.0.0.1:1/shell";
        let shell_html =
            r#"<html><body><div id="root"></div><script src="/app.js"></script></body></html>"#;
        // Shell signals are present ...
        assert!(looks_like_js_shell(shell_html, 40));

        let http_result =
            FetchedWebResource::error(url, "text/html".to_string(), "boom".to_string(), None);
        let result = escalate_if_js_shell(url, shell_html, None, http_result).await;

        // ... but the extraction error short-circuits before any browser tier.
        assert_eq!(result.extraction_error.as_deref(), Some("boom"));
        assert!(!result.metadata.escalated);
        assert!(!result.metadata.partial);
        assert_eq!(result.metadata.tier, None);
    }

    #[tokio::test]
    async fn escalate_keeps_healthy_http_results_without_escalating() {
        let url = "http://127.0.0.1:1/article";
        let html = article_html();
        let prose = "Substantive article prose that runs far past the gate threshold. ".repeat(20);
        let http_result = process_text_content(&url, &prose, "text/plain".to_string(), None, None)
            .with_tier("http");

        // Neither escalation signal fires ...
        assert!(!looks_like_js_shell(
            &html,
            http_result.metadata.original_length.unwrap()
        ));
        assert!(!has_low_quality_text(&http_result.content));

        let result = escalate_if_js_shell(&url, &html, None, http_result).await;

        // ... so the HTTP result comes back untouched.
        assert_eq!(result.extraction_error, None);
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
        assert!(!result.metadata.escalated);
        assert!(!result.metadata.partial);
    }

    #[tokio::test]
    async fn fetch_only_returns_a_js_shell_page_unmarked() {
        let body = br#"<!DOCTYPE html><html><head><title>Shell App</title></head><body><div id="root"></div><noscript>Please enable JavaScript</noscript><p>Loading...</p><script src="/app.js"></script></body></html>"#
            .to_vec();
        let url = serve_one_response("text/html", body.clone(), body.len() as u64).await;

        let result = fetch_web_resource_with_config(&url, None, &fetch_only_config()).await;

        // The empty root mount would make Auto escalate; FetchOnly returns
        // the plain HTTP result with no marks either way.
        assert_eq!(result.extraction_error, None);
        assert_eq!(result.metadata.tier.as_deref(), Some("http"));
        assert!(!result.metadata.escalated);
        assert!(!result.metadata.partial);
        assert_eq!(result.title.as_deref(), Some("Shell App"));
        assert!(result.content.contains("Loading"));
    }

    // ---- config dispatch ----

    #[tokio::test]
    async fn local_dispatch_auto_and_fetch_only_share_the_http_path() {
        let body = b"dispatch probe body".to_vec();
        let auto_url = serve_one_response("text/plain", body.clone(), body.len() as u64).await;
        let only_url = serve_one_response("text/plain", body.clone(), body.len() as u64).await;
        let auto_config = FetchConfig {
            mode: FetchMode::Local,
            local_method: LocalMethod::Auto,
            jina_api_key: None,
        };

        let auto = fetch_web_resource_with_config(&auto_url, None, &auto_config).await;
        let only = fetch_web_resource_with_config(&only_url, None, &fetch_only_config()).await;

        for result in [&auto, &only] {
            assert_eq!(result.extraction_error, None);
            assert_eq!(result.content, "dispatch probe body");
            assert_eq!(result.mime_type, "text/plain");
            assert_eq!(result.metadata.tier.as_deref(), Some("http"));
        }

        // ObscuraOnly / WebViewOnly / ChromeOnly and the Auto fallback
        // branch are intentionally not pinned: each resolves to spawning
        // an external browser (obscura binary, headless Chrome) whose
        // availability and output depend on the developer machine, so no
        // offline-deterministic assertion exists for them. FetchMode::Api
        // likewise requires the real r.jina.ai endpoint.
    }

    // ---- fetch_urls_with_config ----

    #[tokio::test]
    async fn fetch_urls_empty_list_completes_immediately() {
        let (mut rx, handle) = fetch_urls_with_config(&[], None, fetch_only_config()).await;

        assert!(rx.recv().await.is_none());
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn fetch_urls_streams_every_result_then_ends() {
        let body_a = b"alpha body".to_vec();
        let body_b = b"beta body".to_vec();
        let url_a = serve_one_response("text/plain", body_a.clone(), body_a.len() as u64).await;
        let url_b = serve_one_response("text/plain", body_b.clone(), body_b.len() as u64).await;

        let (mut rx, handle) =
            fetch_urls_with_config(&[url_a, url_b], None, fetch_only_config()).await;

        let mut contents = Vec::new();
        while let Some(result) = rx.recv().await {
            assert_eq!(result.extraction_error, None);
            assert_eq!(result.metadata.tier.as_deref(), Some("http"));
            contents.push(result.content);
        }
        handle.await.unwrap();

        assert_eq!(contents.len(), 2);
        assert!(contents.contains(&"alpha body".to_string()));
        assert!(contents.contains(&"beta body".to_string()));
    }

    #[tokio::test]
    async fn fetch_urls_stops_cleanly_when_receiver_drops() {
        let urls = vec![dead_loopback_url(), dead_loopback_url()];

        let (rx, handle) = fetch_urls_with_config(&urls, None, fetch_only_config()).await;
        drop(rx); // first send fails; the sender task must break, not panic

        handle.await.unwrap();
    }

    // ---- build_llm_content_with_attachments ----

    fn text_resource(url: &str, content: &str) -> FetchedWebResource {
        process_text_content(url, content, "text/plain".to_string(), None, None)
    }

    #[test]
    fn attachments_builder_returns_original_content_when_empty() {
        assert_eq!(
            build_llm_content_with_attachments("original", &[]),
            "original"
        );
    }

    #[test]
    fn attachments_builder_formats_error_notes() {
        let failed =
            FetchedWebResource::error("http://x.test/a", String::new(), "boom".to_string(), None);

        assert_eq!(
            build_llm_content_with_attachments("original", &[failed]),
            "original\n\n---\n**Note:** Could not fetch content from http://x.test/a: boom"
        );
    }

    #[test]
    fn attachments_builder_formats_content_blocks_with_trimmed_content() {
        let ok = text_resource("http://x.test/b", "  padded body  \n");

        assert_eq!(
            build_llm_content_with_attachments("original", &[ok]),
            "original\n\n---\n**Content from http://x.test/b:**\n\npadded body"
        );
    }

    #[test]
    fn attachments_builder_appends_each_resource_in_order() {
        let first = text_resource("http://x.test/1", "one");
        let failed =
            FetchedWebResource::error("http://x.test/2", String::new(), "nope".to_string(), None);
        let third = text_resource("http://x.test/3", "three");

        assert_eq!(
            build_llm_content_with_attachments("base", &[first, failed, third]),
            "base\n\n---\n**Content from http://x.test/1:**\n\none\
             \n\n---\n**Note:** Could not fetch content from http://x.test/2: nope\
             \n\n---\n**Content from http://x.test/3:**\n\nthree"
        );
    }
}
