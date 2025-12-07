use crate::models::{CreateProviderRequest, Provider};
use super::AppState;
use tauri::State;

#[tauri::command]
pub async fn create_provider(
    state: State<'_, AppState>,
    req: CreateProviderRequest,
) -> Result<Provider, String> {
    state.db.create_provider(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_provider(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Provider>, String> {
    state.db.get_provider(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> Result<Vec<Provider>, String> {
    state.db.list_providers().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    req: CreateProviderRequest,
) -> Result<Provider, String> {
    state
        .db
        .update_provider(&id, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_provider(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_provider(&id).await.map_err(|e| e.to_string())
}

