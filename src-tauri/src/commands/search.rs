use super::AppState;
use crate::models::SearchResults;
use std::time::Instant;
use tauri::State;

#[tauri::command]
pub async fn search_chat_history(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<SearchResults, String> {
    let limit = limit.unwrap_or(20);
    let offset = offset.unwrap_or(0);

    let start = Instant::now();

    let messages = state
        .db
        .search_messages(&query, limit, offset)
        .await
        .map_err(|e| e.to_string())?;

    let conversations = state
        .db
        .search_conversations(&query, 5)
        .await
        .map_err(|e| e.to_string())?;

    let search_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    Ok(SearchResults {
        messages: messages.clone(),
        conversations,
        total_message_count: messages.len(),
        search_time_ms,
    })
}
