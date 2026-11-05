use super::AppState;
use crate::models::{CreateTranslationHistoryRequest, TranslationHistoryEntry};
use tauri::State;

#[tauri::command]
pub async fn add_translation_history_entry(
    state: State<'_, AppState>,
    req: CreateTranslationHistoryRequest,
) -> Result<Option<TranslationHistoryEntry>, String> {
    state
        .db
        .add_translation_history_entry(req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_translation_history(
    state: State<'_, AppState>,
) -> Result<Vec<TranslationHistoryEntry>, String> {
    state
        .db
        .list_translation_history()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_translation_history_entry(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state
        .db
        .delete_translation_history_entry(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_translation_history(state: State<'_, AppState>) -> Result<(), String> {
    state
        .db
        .clear_translation_history()
        .await
        .map_err(|e| e.to_string())
}
