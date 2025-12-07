//! Web search commands

use crate::web_search::{SearchProvider, WebSearchResponse};

/// Perform a web search using the specified provider
#[tauri::command]
pub async fn perform_web_search(
    query: String,
    max_results: Option<usize>,
    provider: Option<String>,
) -> Result<WebSearchResponse, String> {
    let max = max_results.unwrap_or(5);
    let search_provider = provider
        .as_deref()
        .and_then(SearchProvider::from_id)
        .unwrap_or_default();

    println!(
        "🔍 [perform_web_search] Searching for: {} (max {}, provider: {})",
        query,
        max,
        search_provider.display_name()
    );

    crate::web_search::search(search_provider, &query, max)
        .await
        .map_err(|e| e.to_string())
}

/// Extract search keywords from user input
#[tauri::command]
pub async fn extract_search_keywords(user_input: String) -> Result<String, String> {
    Ok(crate::web_search::extract_search_keywords(&user_input))
}

/// Get the list of available search providers
#[tauri::command]
pub async fn get_search_providers() -> Result<Vec<SearchProviderInfo>, String> {
    Ok(SearchProvider::all()
        .into_iter()
        .map(|p| SearchProviderInfo {
            id: p.id().to_string(),
            name: p.display_name().to_string(),
        })
        .collect())
}

/// Search provider information for frontend
#[derive(serde::Serialize)]
pub struct SearchProviderInfo {
    pub id: String,
    pub name: String,
}
