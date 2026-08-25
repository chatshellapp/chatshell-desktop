use super::AppState;
use crate::blob_sync;
use crate::models::{BlobFetchStatus, FileAttachment, UserAttachment};
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
    state
        .db
        .get_file_attachment(&id)
        .await
        .map_err(|e| e.to_string())
}

/// Fetch-on-open blob pass (plan §5): materialize the attachment bytes this
/// conversation references, newest-first, within the fetch budget. Returns a
/// status per content hash so the UI can render missing/downloading/gone
/// placeholders and stop retrying gone entries until the next merge.
#[tauri::command]
pub async fn fetch_conversation_blobs(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<BlobFetchStatus>, String> {
    let cloud_dir = {
        let guard = state
            .sync_engine
            .lock()
            .map_err(|_| "sync engine poisoned".to_string())?;
        guard
            .as_ref()
            .map(|engine| engine.cloud_dir().to_path_buf())
    };
    let Some(cloud_dir) = cloud_dir else {
        // Sync disabled: every local row is already materialized by
        // construction, nothing to fetch.
        return Ok(Vec::new());
    };
    let attach_dir = crate::storage::get_attachments_dir(&app).map_err(|e| e.to_string())?;
    blob_sync::fetch_conversation_blobs(&state.db, &cloud_dir, &attach_dir, &conversation_id)
        .await
        .map_err(|e| e.to_string())
}
