use crate::models::{Assistant, CreateAssistantRequest};
use super::AppState;
use tauri::State;

#[tauri::command]
pub async fn create_assistant(
    state: State<'_, AppState>,
    req: CreateAssistantRequest,
) -> Result<Assistant, String> {
    state.db.create_assistant(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_assistant(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Assistant>, String> {
    state.db.get_assistant(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_assistants(state: State<'_, AppState>) -> Result<Vec<Assistant>, String> {
    state.db.list_assistants().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_assistant(
    state: State<'_, AppState>,
    id: String,
    req: CreateAssistantRequest,
) -> Result<Assistant, String> {
    state
        .db
        .update_assistant(&id, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_assistant(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_assistant(&id).await.map_err(|e| e.to_string())
}

