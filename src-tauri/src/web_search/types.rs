//! Common types for web search functionality

use serde::{Deserialize, Serialize};
use std::fmt;

/// Supported search engine providers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SearchProvider {
    #[default]
    DuckDuckGo,
    Yahoo,
    Baidu,
}

impl SearchProvider {
    /// Get all available providers
    pub fn all() -> Vec<SearchProvider> {
        vec![
            SearchProvider::DuckDuckGo,
            SearchProvider::Yahoo,
            SearchProvider::Baidu,
        ]
    }

    /// Get the provider's display name
    pub fn display_name(&self) -> &'static str {
        match self {
            SearchProvider::DuckDuckGo => "DuckDuckGo",
            SearchProvider::Yahoo => "Yahoo",
            SearchProvider::Baidu => "Baidu",
        }
    }

    /// Get the provider's identifier (used in settings)
    pub fn id(&self) -> &'static str {
        match self {
            SearchProvider::DuckDuckGo => "duckduckgo",
            SearchProvider::Yahoo => "yahoo",
            SearchProvider::Baidu => "baidu",
        }
    }

    /// Parse from string identifier
    pub fn from_id(id: &str) -> Option<SearchProvider> {
        match id.to_lowercase().as_str() {
            "duckduckgo" => Some(SearchProvider::DuckDuckGo),
            "yahoo" => Some(SearchProvider::Yahoo),
            "baidu" => Some(SearchProvider::Baidu),
            _ => None,
        }
    }
}

impl fmt::Display for SearchProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.id())
    }
}

/// A single search result item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Generic response from web search (works for all providers)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchResponse {
    pub query: String,
    pub results: Vec<SearchResultItem>,
    pub total_results: usize,
    pub searched_at: String,
    pub provider: SearchProvider,
}

/// Response from DuckDuckGo search (legacy, for backwards compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuckDuckGoSearchResponse {
    pub query: String,
    pub results: Vec<SearchResultItem>,
    pub total_results: usize,
    pub searched_at: String,
}

impl From<DuckDuckGoSearchResponse> for WebSearchResponse {
    fn from(response: DuckDuckGoSearchResponse) -> Self {
        WebSearchResponse {
            query: response.query,
            results: response.results,
            total_results: response.total_results,
            searched_at: response.searched_at,
            provider: SearchProvider::DuckDuckGo,
        }
    }
}

/// Result from AI search decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDecisionResult {
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- SearchProvider identifiers ----

    #[test]
    fn all_lists_every_provider_once() {
        let all = SearchProvider::all();
        assert_eq!(all.len(), 3);
        let mut ids: Vec<_> = all.iter().map(|p| p.id()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), all.len(), "duplicate provider id");
        for expected in ["duckduckgo", "yahoo", "baidu"] {
            assert!(ids.contains(&expected), "missing id {expected}");
        }
    }

    #[test]
    fn display_name_and_id_are_stable() {
        assert_eq!(SearchProvider::DuckDuckGo.display_name(), "DuckDuckGo");
        assert_eq!(SearchProvider::Yahoo.display_name(), "Yahoo");
        assert_eq!(SearchProvider::Baidu.display_name(), "Baidu");
        assert_eq!(SearchProvider::DuckDuckGo.id(), "duckduckgo");
        assert_eq!(SearchProvider::Yahoo.id(), "yahoo");
        assert_eq!(SearchProvider::Baidu.id(), "baidu");
    }

    #[test]
    fn display_renders_the_settings_id() {
        assert_eq!(SearchProvider::DuckDuckGo.to_string(), "duckduckgo");
        assert_eq!(SearchProvider::Yahoo.to_string(), "yahoo");
        assert_eq!(SearchProvider::Baidu.to_string(), "baidu");
    }

    #[test]
    fn from_id_parses_known_ids_case_insensitively() {
        assert_eq!(
            SearchProvider::from_id("duckduckgo"),
            Some(SearchProvider::DuckDuckGo)
        );
        assert_eq!(
            SearchProvider::from_id("YAHOO"),
            Some(SearchProvider::Yahoo)
        );
        assert_eq!(
            SearchProvider::from_id("Baidu"),
            Some(SearchProvider::Baidu)
        );
    }

    #[test]
    fn from_id_rejects_unknown_identifiers() {
        assert_eq!(SearchProvider::from_id("google"), None);
        assert_eq!(SearchProvider::from_id(""), None);
        // No trimming: whitespace-padded ids do not match.
        assert_eq!(SearchProvider::from_id(" duckduckgo"), None);
    }

    #[test]
    fn default_provider_is_duckduckgo() {
        assert_eq!(SearchProvider::default(), SearchProvider::DuckDuckGo);
    }

    // ---- SearchProvider serde ----

    #[test]
    fn provider_serde_roundtrips_through_lowercase_names() {
        for (provider, name) in [
            (SearchProvider::DuckDuckGo, "duckduckgo"),
            (SearchProvider::Yahoo, "yahoo"),
            (SearchProvider::Baidu, "baidu"),
        ] {
            let json = serde_json::to_string(&provider).unwrap();
            assert_eq!(json, format!("\"{name}\""));
            let parsed: SearchProvider = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, provider);
        }
    }

    #[test]
    fn provider_deserialize_rejects_variant_case_and_unknown_names() {
        // rename_all = "lowercase" is exact: original variant casing fails.
        assert!(serde_json::from_str::<SearchProvider>("\"DuckDuckGo\"").is_err());
        assert!(serde_json::from_str::<SearchProvider>("\"google\"").is_err());
        assert!(serde_json::from_str::<SearchProvider>("null").is_err());
    }

    // ---- response payloads ----

    fn sample_item() -> SearchResultItem {
        SearchResultItem {
            title: "Rust".to_string(),
            url: "https://www.rust-lang.org/".to_string(),
            snippet: "A language empowering everyone".to_string(),
        }
    }

    #[test]
    fn search_result_item_serde_roundtrip() {
        let item = sample_item();
        let parsed: SearchResultItem =
            serde_json::from_str(&serde_json::to_string(&item).unwrap()).unwrap();
        assert_eq!(parsed.title, item.title);
        assert_eq!(parsed.url, item.url);
        assert_eq!(parsed.snippet, item.snippet);
        // Missing a required field is an error, not a default.
        assert!(serde_json::from_str::<SearchResultItem>(r#"{"title": "t"}"#).is_err());
    }

    #[test]
    fn web_search_response_serde_roundtrip() {
        let response = WebSearchResponse {
            query: "rust async".to_string(),
            results: vec![sample_item()],
            total_results: 1,
            searched_at: "2026-10-20T00:00:00Z".to_string(),
            provider: SearchProvider::Yahoo,
        };
        let parsed: WebSearchResponse =
            serde_json::from_str(&serde_json::to_string(&response).unwrap()).unwrap();
        assert_eq!(parsed.query, "rust async");
        assert_eq!(parsed.total_results, 1);
        assert_eq!(parsed.searched_at, "2026-10-20T00:00:00Z");
        assert_eq!(parsed.provider, SearchProvider::Yahoo);
        assert_eq!(parsed.results.len(), 1);
        assert_eq!(parsed.results[0].url, "https://www.rust-lang.org/");

        // Malformed provider identifier is an error.
        let bad_provider = serde_json::to_string(&response)
            .unwrap()
            .replace("yahoo", "altavista");
        assert!(serde_json::from_str::<WebSearchResponse>(&bad_provider).is_err());
        // Missing required field is an error.
        let missing = r#"{"query": "q", "results": [], "total_results": 0, "searched_at": "t"}"#;
        assert!(serde_json::from_str::<WebSearchResponse>(missing).is_err());
    }

    #[test]
    fn duckduckgo_response_converts_with_duckduckgo_provider() {
        let legacy = DuckDuckGoSearchResponse {
            query: "legacy".to_string(),
            results: vec![sample_item()],
            total_results: 1,
            searched_at: "2026-10-20T00:00:00Z".to_string(),
        };
        let converted: WebSearchResponse = legacy.into();
        assert_eq!(converted.query, "legacy");
        assert_eq!(converted.total_results, 1);
        assert_eq!(converted.searched_at, "2026-10-20T00:00:00Z");
        assert_eq!(converted.provider, SearchProvider::DuckDuckGo);
        assert_eq!(converted.results[0].title, "Rust");
    }

    #[test]
    fn duckduckgo_response_serde_roundtrip() {
        let legacy = DuckDuckGoSearchResponse {
            query: "q".to_string(),
            results: vec![],
            total_results: 0,
            searched_at: "t".to_string(),
        };
        let parsed: DuckDuckGoSearchResponse =
            serde_json::from_str(&serde_json::to_string(&legacy).unwrap()).unwrap();
        assert_eq!(parsed.query, "q");
        assert!(parsed.results.is_empty());
    }

    #[test]
    fn search_decision_result_serde_roundtrip_with_and_without_query() {
        let with_query = SearchDecisionResult {
            reasoning: "dates changed".to_string(),
            search_needed: true,
            search_query: Some("rust 1.90 release date".to_string()),
        };
        let parsed: SearchDecisionResult =
            serde_json::from_str(&serde_json::to_string(&with_query).unwrap()).unwrap();
        assert_eq!(
            parsed.search_query.as_deref(),
            Some("rust 1.90 release date")
        );
        assert!(parsed.search_needed);

        let without_query = SearchDecisionResult {
            reasoning: "no external facts needed".to_string(),
            search_needed: false,
            search_query: None,
        };
        let parsed: SearchDecisionResult =
            serde_json::from_str(&serde_json::to_string(&without_query).unwrap()).unwrap();
        assert_eq!(parsed.search_query, None);
        assert!(!parsed.search_needed);
    }
}
