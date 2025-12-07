use crate::models::{ContextEnrichment, FetchResult, SearchResult};
use super::AppState;
use tauri::State;

// ==========================================================================
// CATEGORY 2: CONTEXT ENRICHMENTS (system-fetched content)
// ==========================================================================

#[tauri::command]
pub async fn get_message_contexts(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Vec<ContextEnrichment>, String> {
    state
        .db
        .get_message_contexts(&message_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_search_result(
    state: State<'_, AppState>,
    id: String,
) -> Result<SearchResult, String> {
    state.db.get_search_result(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_fetch_result(
    state: State<'_, AppState>,
    id: String,
) -> Result<FetchResult, String> {
    state.db.get_fetch_result(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_fetch_results_by_source(
    state: State<'_, AppState>,
    source_type: String,
    source_id: String,
) -> Result<Vec<FetchResult>, String> {
    state
        .db
        .get_fetch_results_by_source(&source_type, &source_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_fetch_results_by_message(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Vec<FetchResult>, String> {
    state
        .db
        .get_fetch_results_by_message(&message_id)
        .await
        .map_err(|e| e.to_string())
}

