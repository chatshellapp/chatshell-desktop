use super::AppState;
use crate::models::{ProcessStep, SearchDecision, ThinkingStep};
use tauri::State;

// ==========================================================================
// CATEGORY 3: PROCESS STEPS (AI workflow artifacts)
// ==========================================================================

#[tauri::command]
pub async fn get_message_steps(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Vec<ProcessStep>, String> {
    state
        .db
        .get_message_steps(&message_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_thinking_step(
    state: State<'_, AppState>,
    id: String,
) -> Result<ThinkingStep, String> {
    state
        .db
        .get_thinking_step(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_search_decision(
    state: State<'_, AppState>,
    id: String,
) -> Result<SearchDecision, String> {
    state
        .db
        .get_search_decision(&id)
        .await
        .map_err(|e| e.to_string())
}
