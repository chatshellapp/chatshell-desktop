//! Web search tool for LLM agents
//!
//! Allows the AI to actively search the web for information.
//! This tool wraps the existing web_search module functionality.

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::web_search::{SearchProvider, search};

/// Arguments for web search tool
#[derive(Debug, Clone, Deserialize)]
pub struct WebSearchArgs {
    /// The search query to execute
    pub query: String,
    /// Maximum number of results to return (default: 5)
    #[serde(default = "default_max_results")]
    pub max_results: usize,
    /// Search provider to use (duckduckgo, yahoo, baidu)
    #[serde(default)]
    pub provider: Option<String>,
}

fn default_max_results() -> usize {
    5
}

/// Error type for web search tool
#[derive(Debug, thiserror::Error)]
#[error("Web search error: {0}")]
pub struct WebSearchError(String);

/// Web search tool implementation
///
/// This tool allows the AI agent to search the web for information.
/// It wraps the existing web_search module and formats results for LLM consumption.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WebSearchTool {
    /// Default search provider
    #[serde(default)]
    pub default_provider: SearchProvider,
}

impl WebSearchTool {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_provider(provider: SearchProvider) -> Self {
        Self {
            default_provider: provider,
        }
    }
}

impl Tool for WebSearchTool {
    const NAME: &'static str = "web_search";

    type Error = WebSearchError;
    type Args = WebSearchArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "web_search".to_string(),
            description: "Search the web for information using a search engine. \
                Returns a list of relevant search results with titles, URLs, and snippets. \
                Use this when you need to find current information, facts, or references from the web."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to execute"
                    },
                    "max_results": {
                        "type": "number",
                        "description": "Maximum number of results to return (default: 5)"
                    },
                    "provider": {
                        "type": "string",
                        "enum": ["duckduckgo", "yahoo", "baidu"],
                        "description": "Search provider to use (default: duckduckgo)"
                    }
                },
                "required": ["query"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] web_search: query=\"{}\" max_results={}",
            args.query,
            args.max_results
        );

        // Determine provider
        let provider = args
            .provider
            .as_ref()
            .and_then(|p| SearchProvider::from_id(p))
            .unwrap_or(self.default_provider);

        // Execute search
        let response = search(provider, &args.query, args.max_results)
            .await
            .map_err(|e| WebSearchError(e.to_string()))?;

        // Format results as markdown for the LLM
        let mut output = format!(
            "## Search Results for: \"{}\"\n\n**Provider:** {}\n**Results Found:** {}\n\n",
            response.query,
            response.provider.display_name(),
            response.total_results
        );

        if response.results.is_empty() {
            output.push_str("No results found for this query.\n");
        } else {
            for (i, result) in response.results.iter().enumerate() {
                output.push_str(&format!(
                    "### {}. {}\n**URL:** {}\n\n{}\n\n---\n\n",
                    i + 1,
                    result.title,
                    result.url,
                    result.snippet
                ));
            }
        }

        tracing::info!(
            "🔧 [tool-result] web_search: returned {} results",
            response.results.len()
        );

        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_web_search_tool_creation() {
        let tool = WebSearchTool::new();
        assert_eq!(tool.default_provider, SearchProvider::DuckDuckGo);
    }

    #[test]
    fn test_web_search_tool_with_provider() {
        let tool = WebSearchTool::with_provider(SearchProvider::Yahoo);
        assert_eq!(tool.default_provider, SearchProvider::Yahoo);
    }

    #[test]
    fn test_default_max_results() {
        assert_eq!(default_max_results(), 5);
    }
}
