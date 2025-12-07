use tauri::State;

use crate::commands::AppState;
use crate::models::{CreatePromptRequest, Prompt};

#[tauri::command]
pub async fn create_prompt(state: State<'_, AppState>, req: CreatePromptRequest) -> Result<Prompt, String> {
    state.db.create_prompt(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt(state: State<'_, AppState>, id: String) -> Result<Option<Prompt>, String> {
    state.db.get_prompt(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_prompts(state: State<'_, AppState>) -> Result<Vec<Prompt>, String> {
    state.db.list_prompts().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_prompts_by_category(state: State<'_, AppState>, category: String) -> Result<Vec<Prompt>, String> {
    state.db.list_prompts_by_category(&category).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_prompt(
    state: State<'_, AppState>,
    id: String,
    req: CreatePromptRequest,
) -> Result<Prompt, String> {
    state.db.update_prompt(&id, req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_prompt(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_prompt(&id).await.map_err(|e| e.to_string())
}

