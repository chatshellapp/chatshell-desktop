//! Web fetch tool for LLM agents
//!
//! Allows the AI to actively fetch and read web page content.
//! This tool wraps the existing web_fetch module functionality.
//! Direct image URLs are not downloaded here: the `read` tool fetches them
//! through its own in-memory URL path, so this tool steers image responses
//! there instead of materializing bytes on disk.

use std::fmt;

use chatshell_agent_core::tools::{UrlByteFetcher, UrlBytes};
use futures::StreamExt;
use futures::future::BoxFuture;
use rig::agent::tool::Tool;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::web_fetch::{
    FetchConfig, HTTP_CLIENT, MAX_REMOTE_SOURCE_BYTES, fetch_web_resource_with_config,
};

/// Desktop HTTP adapter for the core read tool's remote-URL seam.
///
/// The response stays in memory and is bounded before it reaches `ReadTool`;
/// redirects are handled by the shared application client.
#[derive(Debug, Clone, Default)]
pub struct HttpUrlByteFetcher;

impl UrlByteFetcher for HttpUrlByteFetcher {
    fn fetch(&self, url: &str) -> BoxFuture<'static, Result<UrlBytes, String>> {
        let url = url.to_string();
        Box::pin(async move {
            let parsed =
                reqwest::Url::parse(&url).map_err(|error| format!("Invalid URL: {error}"))?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(format!("Unsupported URL scheme: {}", parsed.scheme()));
            }

            let response = HTTP_CLIENT
                .get(parsed)
                .header(
                    "Accept",
                    "image/*, text/*, application/json, application/xml, */*",
                )
                .send()
                .await
                .map_err(|error| format!("HTTP request failed: {error}"))?;
            if !response.status().is_success() {
                return Err(format!("HTTP error: {}", response.status()));
            }

            if let Some(content_length) = response.content_length()
                && content_length > MAX_REMOTE_SOURCE_BYTES as u64
            {
                return Err(format!(
                    "Response exceeds the {} byte source limit (declared {} bytes)",
                    MAX_REMOTE_SOURCE_BYTES, content_length
                ));
            }

            let final_url = response.url().to_string();
            let mime_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_string();
            let initial_capacity = response
                .content_length()
                .and_then(|length| usize::try_from(length).ok())
                .unwrap_or(0)
                .min(MAX_REMOTE_SOURCE_BYTES);
            let mut bytes = Vec::with_capacity(initial_capacity);
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|error| format!("Failed to read response body: {error}"))?;
                let next_len = bytes
                    .len()
                    .checked_add(chunk.len())
                    .ok_or_else(|| "Response size overflow".to_string())?;
                if next_len > MAX_REMOTE_SOURCE_BYTES {
                    return Err(format!(
                        "Response exceeds the {} byte source limit",
                        MAX_REMOTE_SOURCE_BYTES
                    ));
                }
                bytes.extend_from_slice(&chunk);
            }

            Ok(UrlBytes {
                bytes,
                mime_type,
                final_url,
            })
        })
    }
}

/// Arguments for web fetch tool
#[derive(Debug, Clone, Deserialize)]
pub struct WebFetchArgs {
    /// The URL to fetch
    pub url: String,
    /// Maximum characters to return (default: 50000)
    #[serde(default)]
    pub max_chars: Option<usize>,
}

/// Error type for web fetch tool
#[derive(Debug, thiserror::Error)]
#[error("Web fetch error: {0}")]
pub struct WebFetchError(String);

/// Web fetch tool implementation
///
/// This tool allows the AI agent to fetch and read web page content.
/// It uses the existing web_fetch module which supports:
/// - HTTP fetching with automatic content extraction
/// - Browser-tier fallback for JavaScript-rendered pages (including the
///   JS-shell and low-quality-output triggers)
/// - Direct image URLs steer the model to the `read` tool's in-memory
///   URL path instead of downloading bytes
#[derive(Clone, Default)]
pub struct WebFetchTool {
    /// Fetch configuration
    config: FetchConfig,
}

impl fmt::Debug for WebFetchTool {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WebFetchTool")
            .field("config", &self.config)
            .finish()
    }
}

// Manual Serialize/Deserialize since FetchConfig doesn't derive them
impl Serialize for WebFetchTool {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // Serialize as a unit struct since config is runtime-only
        serializer.serialize_unit_struct("WebFetchTool")
    }
}

impl<'de> Deserialize<'de> for WebFetchTool {
    fn deserialize<D>(_deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(Self::default())
    }
}

impl WebFetchTool {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Tool for WebFetchTool {
    const NAME: &'static str = "web_fetch";

    type Error = WebFetchError;
    type Args = WebFetchArgs;
    type Output = String;

    fn description(&self) -> String {
        "Fetch and extract the main content from a web page. \
            Returns the page title and cleaned text content suitable for reading. \
            Use this to read articles, documentation, blog posts, or any web page content. \
            The content is extracted using readability algorithms to remove ads and navigation. \
            Direct image URLs are not extracted; call the read tool on the URL instead."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL of the web page to fetch"
                },
                "max_chars": {
                    "type": "number",
                    "description": "Maximum characters to return (default: 50000). Use smaller values for quick summaries."
                }
            },
            "required": ["url"]
        })
    }

    async fn call(
        &self,
        _context: &mut rig::agent::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] web_fetch: url=\"{}\" max_chars={:?}",
            args.url,
            args.max_chars
        );

        let max_chars = args.max_chars.unwrap_or(50000);

        // Fetch the web resource
        let resource =
            fetch_web_resource_with_config(&args.url, Some(max_chars), &self.config).await;

        // Check for errors
        if let Some(error) = &resource.extraction_error {
            tracing::warn!("🔧 [tool-error] web_fetch failed: {}", error);
            return Err(WebFetchError(format!(
                "Failed to fetch {}: {}",
                args.url, error
            )));
        }

        // Format output for LLM consumption
        let mut output = String::new();

        // Add title if available
        if let Some(title) = &resource.title {
            output.push_str(&format!("# {}\n\n", title));
        }

        // Add metadata
        output.push_str(&format!("**URL:** {}\n", resource.url));
        output.push_str(&format!("**Content Type:** {}\n", resource.mime_type));

        if resource.metadata.truncated {
            output.push_str(&format!(
                "**Note:** Content was truncated to {} characters\n",
                max_chars
            ));
        }

        output.push_str("\n---\n\n");

        // Add main content
        output.push_str(&resource.content);

        let content_len = resource.content.len();
        tracing::info!(
            "🔧 [tool-result] web_fetch: fetched {} chars from \"{}\"",
            content_len,
            resource.title.as_deref().unwrap_or("(no title)")
        );

        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::web_fetch::FetchMode;
    use rig::agent::tool::ToolContext;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn serve_one_response(content_type: &str, body: Vec<u8>, declared_len: u64) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let content_type = content_type.to_string();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let _ = socket.read(&mut request).await;
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                content_type, declared_len
            );
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
        });
        format!("http://{}/image", address)
    }

    #[test]
    fn test_web_fetch_tool_creation() {
        let tool = WebFetchTool::new();
        assert!(matches!(tool.config.mode, FetchMode::Local));
    }

    #[test]
    fn test_web_fetch_args_default_max_chars() {
        let args: WebFetchArgs = serde_json::from_str(r#"{"url": "https://example.com"}"#).unwrap();
        assert_eq!(args.url, "https://example.com");
        assert_eq!(args.max_chars, None);
    }

    #[tokio::test]
    async fn read_url_fetcher_returns_raw_response() {
        let body = b"remote image bytes".to_vec();
        let url = serve_one_response("image/jpeg", body.clone(), body.len() as u64).await;

        let fetched = HttpUrlByteFetcher.fetch(&url).await.unwrap();

        assert_eq!(fetched.bytes, body);
        assert_eq!(fetched.mime_type, "image/jpeg");
        assert_eq!(fetched.final_url, url);
    }

    #[tokio::test]
    async fn read_tool_consumes_remote_image_in_memory() {
        use chatshell_agent_core::tools::{ReadArgs, ReadTool};

        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0DIHDR\x00\x00\x00\x64\x00\x00\x00\x64".to_vec();
        let url = serve_one_response("image/png", png.clone(), png.len() as u64).await;
        let tool = ReadTool::new()
            .with_main_model_vision(false)
            .with_url_fetcher(Arc::new(HttpUrlByteFetcher));
        let mut context = ToolContext::new();

        let output = tool
            .call(
                &mut context,
                ReadArgs {
                    path: url,
                    offset: None,
                    limit: None,
                    pages: None,
                    question: None,
                },
            )
            .await
            .unwrap();

        assert!(output.contains("[Image: PNG, 100x100"), "output: {output}");
        assert!(
            output.contains("does not accept image input"),
            "output: {output}"
        );
    }

    #[tokio::test]
    async fn read_url_fetcher_rejects_declared_oversize() {
        let url = serve_one_response(
            "image/png",
            Vec::new(),
            (MAX_REMOTE_SOURCE_BYTES + 1) as u64,
        )
        .await;

        let error = HttpUrlByteFetcher.fetch(&url).await.unwrap_err();

        assert!(error.contains("source limit"), "error: {error}");
    }

    #[tokio::test]
    async fn read_url_fetcher_rejects_non_http_scheme() {
        let error = HttpUrlByteFetcher
            .fetch("file:///tmp/image.png")
            .await
            .unwrap_err();

        assert!(error.contains("Unsupported URL scheme"), "error: {error}");
    }

    #[tokio::test]
    async fn web_fetch_on_direct_image_steers_to_read() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(b"payload");
        let url = serve_one_response("image/png", png.clone(), png.len() as u64).await;
        let tool = WebFetchTool::new();
        let mut context = ToolContext::new();

        let output = tool
            .call(
                &mut context,
                WebFetchArgs {
                    url,
                    max_chars: None,
                },
            )
            .await
            .unwrap();

        assert!(output.contains("read tool"), "output: {output}");
    }
}
