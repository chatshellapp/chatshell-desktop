use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ==========================================================================
// CONTEXT ENRICHMENTS (system-fetched content)
// ==========================================================================

/// Search result - stores metadata about a web search operation
/// Content is not stored in filesystem, only metadata in database
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SearchResult {
    pub id: String,
    pub message_id: String,
    pub query: String,
    pub engine: String, // "google" | "bing" | "duckduckgo"
    pub total_results: Option<i64>,
    pub display_order: i32,
    pub searched_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSearchResultRequest {
    pub message_id: String,
    pub query: String,
    pub engine: String,
    pub total_results: Option<i64>,
    pub display_order: Option<i32>,
    pub searched_at: String,
}

/// Fetch result - stores metadata about a fetched web resource
/// Content is stored in filesystem at storage_path
/// source_type distinguishes between search-initiated and user-provided URL fetches
/// content_hash enables deduplication - same content shares storage
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FetchResult {
    pub id: String,
    pub source_type: String,       // "search" | "user_link"
    pub source_id: Option<String>, // FK to search_results.id (only for source_type="search")
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub storage_path: String, // Path relative to attachments dir: "fetch/{hash}.md"
    pub content_type: String, // MIME type of stored content: "text/markdown", "text/plain"
    pub original_mime: Option<String>, // Original MIME type from HTTP response
    pub status: String,       // "pending" | "processing" | "success" | "failed"
    pub error: Option<String>,
    pub keywords: Option<String>,
    pub headings: Option<String>, // JSON array of headings
    pub original_size: Option<i64>,
    pub processed_size: Option<i64>,
    pub favicon_url: Option<String>,
    pub content_hash: Option<String>, // Blake3 hash of stored content for deduplication
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFetchResultRequest {
    pub source_type: Option<String>, // defaults to "search"
    pub source_id: Option<String>,
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub storage_path: String,
    pub content_type: String,
    pub original_mime: Option<String>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub keywords: Option<String>,
    pub headings: Option<String>,
    pub original_size: Option<i64>,
    pub processed_size: Option<i64>,
    pub favicon_url: Option<String>,
    pub content_hash: Option<String>,
}

/// Context enrichment type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ContextType {
    SearchResult,
    FetchResult,
}

impl std::fmt::Display for ContextType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContextType::SearchResult => write!(f, "search_result"),
            ContextType::FetchResult => write!(f, "fetch_result"),
        }
    }
}

impl std::str::FromStr for ContextType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "search_result" => Ok(ContextType::SearchResult),
            "fetch_result" => Ok(ContextType::FetchResult),
            _ => Err(format!("Invalid context type: {}", s)),
        }
    }
}

/// Unified context enrichment enum for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContextEnrichment {
    SearchResult(SearchResult),
    FetchResult(FetchResult),
}

impl ContextEnrichment {
    pub fn id(&self) -> &str {
        match self {
            ContextEnrichment::SearchResult(s) => &s.id,
            ContextEnrichment::FetchResult(f) => &f.id,
        }
    }

    pub fn context_type(&self) -> ContextType {
        match self {
            ContextEnrichment::SearchResult(_) => ContextType::SearchResult,
            ContextEnrichment::FetchResult(_) => ContextType::FetchResult,
        }
    }
}

