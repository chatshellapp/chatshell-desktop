use super::AppState;
use crate::models::MessageResources;
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

#[tauri::command]
pub fn copy_image_to_clipboard(
    app: tauri::AppHandle,
    storage_path: Option<String>,
    base64_data: Option<String>,
) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::borrow::Cow;

    let bytes = if let Some(path) = storage_path {
        crate::storage::read_binary(&app, &path).map_err(|e| e.to_string())?
    } else if let Some(data) = base64_data {
        let b64 = data.split_once(',').map(|(_, b)| b).unwrap_or(&data);
        STANDARD
            .decode(b64)
            .map_err(|e| format!("Failed to decode base64: {}", e))?
    } else {
        return Err("No image data provided".to_string());
    };

    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("Failed to decode image: {}", e))?;
    let rgba = img.to_rgba8();
    let (w, h) = {
        use image::GenericImageView;
        img.dimensions()
    };

    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: Cow::from(rgba.into_raw()),
        })
        .map_err(|e| format!("Failed to copy image: {}", e))?;

    Ok(())
}
