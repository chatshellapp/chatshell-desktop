use super::AppState;
use crate::models::{CreateUserRequest, User};
use tauri::State;

#[tauri::command]
pub async fn create_user(
    state: State<'_, AppState>,
    req: CreateUserRequest,
) -> Result<User, String> {
    state.db.create_user(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user(state: State<'_, AppState>, id: String) -> Result<Option<User>, String> {
    state.db.get_user(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_self_user(state: State<'_, AppState>) -> Result<Option<User>, String> {
    state.db.get_self_user().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_users(state: State<'_, AppState>) -> Result<Vec<User>, String> {
    state.db.list_users().await.map_err(|e| e.to_string())
}
