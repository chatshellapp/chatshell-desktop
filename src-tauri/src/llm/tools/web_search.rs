//! Web search tool for LLM agents
//!
//! Allows the AI to actively search the web for information.
//! This tool wraps the existing web_search module functionality.

use rig::agent::tool::Tool;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::web_search::SearchProvider;

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

    fn description(&self) -> String {
        "Search the web for information using a search engine. \
                Returns a list of relevant search results with titles, URLs, and snippets. \
                Engines fall back automatically when one is blocked or returns nothing; \
                the response names the engine that served the results. \
                Use web_fetch on a result URL to read the full page."
            .to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        // No engine parameter: the model has no basis for choosing between
        // scraping targets, and the user's configured provider plus the
        // automatic fallback already covers availability. Engine selection
        // stays a settings concern.
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to execute"
                },
                "max_results": {
                    "type": "number",
                    "description": "Maximum number of results to return (default: 5)"
                }
            },
            "required": ["query"]
        })
    }

    async fn call(
        &self,
        _context: &mut rig::agent::tool::ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] web_search: query=\"{}\" max_results={}",
            args.query,
            args.max_results
        );

        // Determine provider. The `provider` argument is no longer
        // advertised to the model; it remains accepted for explicit callers.
        let preferred = args
            .provider
            .as_ref()
            .and_then(|p| SearchProvider::from_id(p))
            .unwrap_or(self.default_provider);

        // Execute search, degrading across engines on failure or zero results.
        let result =
            crate::web_search::search_with_fallback(preferred, &args.query, args.max_results)
                .await
                .map_err(|e| WebSearchError(e.to_string()))?;
        let response = &result.response;

        // Format results as markdown for the LLM
        let mut output = format!(
            "## Search Results for: \"{}\"\n\n**Provider:** {}\n**Results Found:** {}\n\n",
            response.query,
            response.provider.display_name(),
            response.total_results
        );

        if !result.failures.is_empty() {
            let attempted: Vec<String> = result
                .failures
                .iter()
                .map(|(provider, reason)| format!("{} ({reason})", provider.display_name()))
                .collect();
            output.push_str(&format!(
                "**Note:** Earlier engines returned nothing: {}. These results came from {}.\n\n",
                attempted.join(", "),
                response.provider.display_name()
            ));
        }

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
            "🔧 [tool-result] web_search: returned {} results from {}",
            response.results.len(),
            response.provider.display_name()
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

    #[test]
    fn parameters_do_not_expose_engine_selection() {
        let tool = WebSearchTool::new();
        let params = rig::agent::tool::Tool::parameters(&tool);
        let properties = params
            .get("properties")
            .and_then(|value| value.as_object())
            .expect("properties object");
        assert!(properties.contains_key("query"));
        assert!(properties.contains_key("max_results"));
        assert!(
            !properties.contains_key("provider"),
            "engine choice stays a settings concern"
        );
    }
}
