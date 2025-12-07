use crate::models::{FileAttachment, UserAttachment};
use super::AppState;
use tauri::State;

// ==========================================================================
// CATEGORY 1: USER ATTACHMENTS (user-provided files)
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

