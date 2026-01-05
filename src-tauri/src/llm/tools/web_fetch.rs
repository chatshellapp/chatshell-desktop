//! Web fetch tool for LLM agents
//!
//! Allows the AI to actively fetch and read web page content.
//! This tool wraps the existing web_fetch module functionality.

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::web_fetch::{FetchConfig, FetchMode, LocalMethod, fetch_web_resource_with_config};

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
/// - Headless browser fallback for JavaScript-rendered pages
/// - Readability algorithm for article extraction
#[derive(Debug, Clone, Default)]
pub struct WebFetchTool {
    /// Fetch configuration
    config: FetchConfig,
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

    pub fn with_config(config: FetchConfig) -> Self {
        Self { config }
    }

    /// Create a tool configured for local fetching only (no external API)
    pub fn local_only() -> Self {
        Self {
            config: FetchConfig {
                mode: FetchMode::Local,
                local_method: LocalMethod::Auto,
                jina_api_key: None,
            },
        }
    }
}

impl Tool for WebFetchTool {
    const NAME: &'static str = "web_fetch";

    type Error = WebFetchError;
    type Args = WebFetchArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "web_fetch".to_string(),
            description: "Fetch and extract the main content from a web page. \
                Returns the page title and cleaned text content suitable for reading. \
                Use this to read articles, documentation, blog posts, or any web page content. \
                The content is extracted using readability algorithms to remove ads and navigation."
                .to_string(),
            parameters: json!({
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
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
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

    #[test]
    fn test_web_fetch_tool_creation() {
        let tool = WebFetchTool::new();
        assert!(matches!(tool.config.mode, FetchMode::Local));
    }

    #[test]
    fn test_web_fetch_tool_local_only() {
        let tool = WebFetchTool::local_only();
        assert!(matches!(tool.config.mode, FetchMode::Local));
        assert!(matches!(tool.config.local_method, LocalMethod::Auto));
    }

    #[test]
    fn test_web_fetch_args_default_max_chars() {
        let args: WebFetchArgs = serde_json::from_str(r#"{"url": "https://example.com"}"#).unwrap();
        assert_eq!(args.url, "https://example.com");
        assert_eq!(args.max_chars, None);
    }
}
