use crate::models::MessageResources;
use super::AppState;
use tauri::State;

// ==========================================================================
// COMBINED: Get All Message Resources
// ==========================================================================

#[tauri::command]
pub async fn get_message_resources(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<MessageResources, String> {
    state
        .db
        .get_message_resources(&message_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_fetch_content(
    app: tauri::AppHandle,
    storage_path: String,
) -> Result<String, String> {
    crate::storage::read_content(&app, &storage_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_file_content(
    app: tauri::AppHandle,
    storage_path: String,
) -> Result<String, String> {
    crate::storage::read_content(&app, &storage_path).map_err(|e| e.to_string())
}

// Read arbitrary text file from filesystem (for files selected via dialog)
#[tauri::command]
pub async fn read_text_file_from_path(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

// Read arbitrary binary file as base64 (for files selected via dialog)
#[tauri::command]
pub async fn read_file_as_base64(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
pub async fn read_image_base64(
    app: tauri::AppHandle,
    storage_path: String,
) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let bytes = crate::storage::read_binary(&app, &storage_path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn get_attachment_url(app: tauri::AppHandle, storage_path: String) -> Result<String, String> {
    let full_path =
        crate::storage::get_full_path(&app, &storage_path).map_err(|e| e.to_string())?;
    Ok(full_path.to_string_lossy().to_string())
}

