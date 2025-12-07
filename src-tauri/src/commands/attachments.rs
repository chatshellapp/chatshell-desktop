use crate::models::{FileAttachment, UserAttachment, UserLink};
use super::AppState;
use tauri::State;

// ==========================================================================
// CATEGORY 1: USER ATTACHMENTS (user-provided files and links)
// ==========================================================================

#[tauri::command]
pub async fn get_message_attachments(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Vec<UserAttachment>, String> {
    state
        .db
        .get_message_attachments(&message_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_attachment(
    state: State<'_, AppState>,
    id: String,
) -> Result<FileAttachment, String> {
    state.db.get_file_attachment(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user_link(state: State<'_, AppState>, id: String) -> Result<UserLink, String> {
    state.db.get_user_link(&id).await.map_err(|e| e.to_string())
}

