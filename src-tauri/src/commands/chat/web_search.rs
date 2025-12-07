//! Web search commands

/// Perform a DuckDuckGo web search
#[tauri::command]
pub async fn perform_web_search(
    query: String,
    max_results: Option<usize>,
) -> Result<crate::web_search::DuckDuckGoSearchResponse, String> {
    let max = max_results.unwrap_or(5);
    println!(
        "🔍 [perform_web_search] Searching for: {} (max {})",
        query, max
    );

    crate::web_search::search_duckduckgo(&query, max)
        .await
        .map_err(|e| e.to_string())
}

/// Extract search keywords from user input
#[tauri::command]
pub async fn extract_search_keywords(user_input: String) -> Result<String, String> {
    Ok(crate::web_search::extract_search_keywords(&user_input))
}

