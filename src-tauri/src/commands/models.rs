use super::AppState;
use crate::models::{CreateModelRequest, Model};
use tauri::State;

#[tauri::command]
pub async fn create_model(
    state: State<'_, AppState>,
    req: CreateModelRequest,
) -> Result<Model, String> {
    state.db.create_model(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_model(state: State<'_, AppState>, id: String) -> Result<Option<Model>, String> {
    state.db.get_model(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Vec<Model>, String> {
    state.db.list_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_all_models(state: State<'_, AppState>) -> Result<Vec<Model>, String> {
    state.db.list_all_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_model(
    state: State<'_, AppState>,
    id: String,
    req: CreateModelRequest,
) -> Result<Model, String> {
    state
        .db
        .update_model(&id, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_model(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_model(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn soft_delete_model(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .db
        .soft_delete_model(&id)
        .await
        .map_err(|e| e.to_string())
}
