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

/// Batch variant of `get_message_resources`: one IPC round-trip for a whole
/// message window. Only messages that actually have resources are returned.
#[tauri::command]
pub async fn get_message_resources_batch(
    state: State<'_, AppState>,
    message_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, MessageResources>, String> {
    state
        .db
        .get_message_resources_batch(&message_ids)
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

/// Extract the text layer from a PDF selected via the native file dialog.
#[tauri::command]
pub async fn extract_pdf_text_from_path(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read PDF {}: {}", path, e))?;
    extract_pdf_text_bytes(&bytes)
}

/// Extract the text layer from PDF bytes supplied by the webview
/// (drag-and-drop / clipboard), as standard base64.
#[tauri::command]
pub async fn extract_pdf_text_from_base64(base64: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let bytes = STANDARD
        .decode(&base64)
        .map_err(|e| format!("Failed to decode PDF data: {}", e))?;
    extract_pdf_text_bytes(&bytes)
}

fn extract_pdf_text_bytes(bytes: &[u8]) -> Result<String, String> {
    let text = chatshell_agent_core::pdf_text::extract_pdf_text(bytes)
        .map_err(|e| format!("Failed to extract PDF text: {}", e))?;
    if text.trim().is_empty() {
        return Err(
            "No extractable text found in the PDF (it may contain only scanned images)."
                .to_string(),
        );
    }
    Ok(text)
}

/// Extract readable text from an OOXML document in attachment storage
/// (docx/docm/xlsx/xlsm/pptx/pptm). Storage paths keep the original
/// extension, which selects the extractor.
#[tauri::command]
pub async fn extract_office_text_from_storage(
    app: tauri::AppHandle,
    storage_path: String,
) -> Result<String, String> {
    let bytes = crate::storage::read_binary(&app, &storage_path).map_err(|e| e.to_string())?;
    extract_office_text_bytes(&bytes, &storage_path)
}

/// Same extraction for bytes supplied by the webview (preview of an
/// attachment that has not been persisted yet).
#[tauri::command]
pub async fn extract_office_text_from_base64(
    base64: String,
    file_name: String,
) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let bytes = STANDARD
        .decode(&base64)
        .map_err(|e| format!("Failed to decode document data: {}", e))?;
    extract_office_text_bytes(&bytes, &file_name)
}

/// Dispatch OOXML text extraction by file extension. Mirrors the read
/// tool's `read_office` contract with preview defaults: first sheet of a
/// spreadsheet, full (already bounded) text for documents and slides.
fn extract_office_text_bytes(bytes: &[u8], file_name: &str) -> Result<String, String> {
    use chatshell_agent_core::office;

    let ext = std::path::Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if office::is_legacy_office_extension(&ext) {
        return Err(office::legacy_message(&ext));
    }
    match ext.as_str() {
        "docx" | "docm" => office::read_docx(bytes).map_err(|e| e.to_string()),
        "pptx" | "pptm" => office::read_pptx(bytes).map_err(|e| e.to_string()),
        "xlsx" | "xlsm" => office::read_xlsx(bytes, None, None, false).map_err(|e| e.to_string()),
        _ => Err(format!(
            "Unsupported office extension \".{ext}\" for text extraction."
        )),
    }
}

#[cfg(test)]
mod office_preview_tests {
    use super::*;

    /// Minimal stored-mode docx: one paragraph reading "Hello office
    /// preview". Built with python's zipfile (ZIP_STORED).
    const MINIMAL_DOCX: &[u8] = &[
        80, 75, 3, 4, 20, 0, 0, 0, 0, 0, 53, 87, 83, 93, 186, 153, //
        26, 110, 221, 0, 0, 0, 221, 0, 0, 0, 17, 0, 0, 0, 119, 111, //
        114, 100, 47, 100, 111, 99, 117, 109, 101, 110, 116, 46, 120, 109, 108, 60, //
        63, 120, 109, 108, 32, 118, 101, 114, 115, 105, 111, 110, 61, 34, 49, 46, //
        48, 34, 32, 101, 110, 99, 111, 100, 105, 110, 103, 61, 34, 85, 84, 70, //
        45, 56, 34, 32, 115, 116, 97, 110, 100, 97, 108, 111, 110, 101, 61, 34, //
        121, 101, 115, 34, 63, 62, 60, 119, 58, 100, 111, 99, 117, 109, 101, 110, //
        116, 32, 120, 109, 108, 110, 115, 58, 119, 61, 34, 104, 116, 116, 112, 58, //
        47, 47, 115, 99, 104, 101, 109, 97, 115, 46, 111, 112, 101, 110, 120, 109, //
        108, 102, 111, 114, 109, 97, 116, 115, 46, 111, 114, 103, 47, 119, 111, 114, //
        100, 112, 114, 111, 99, 101, 115, 115, 105, 110, 103, 109, 108, 47, 50, 48, //
        48, 54, 47, 109, 97, 105, 110, 34, 62, 60, 119, 58, 98, 111, 100, 121, //
        62, 60, 119, 58, 112, 62, 60, 119, 58, 114, 62, 60, 119, 58, 116, 62, //
        72, 101, 108, 108, 111, 32, 111, 102, 102, 105, 99, 101, 32, 112, 114, 101, //
        118, 105, 101, 119, 60, 47, 119, 58, 116, 62, 60, 47, 119, 58, 114, 62, //
        60, 47, 119, 58, 112, 62, 60, 47, 119, 58, 98, 111, 100, 121, 62, 60, //
        47, 119, 58, 100, 111, 99, 117, 109, 101, 110, 116, 62, 80, 75, 1, 2, //
        20, 3, 20, 0, 0, 0, 0, 0, 53, 87, 83, 93, 186, 153, 26, 110, //
        221, 0, 0, 0, 221, 0, 0, 0, 17, 0, 0, 0, 0, 0, 0, 0, //
        0, 0, 0, 0, 128, 1, 0, 0, 0, 0, 119, 111, 114, 100, 47, 100, //
        111, 99, 117, 109, 101, 110, 116, 46, 120, 109, 108, 80, 75, 5, 6, 0, //
        0, 0, 0, 1, 0, 1, 0, 63, 0, 0, 0, 12, 1, 0, 0, 0, //
        0,
    ];

    #[test]
    fn office_extraction_dispatches_by_extension() {
        let text = extract_office_text_bytes(MINIMAL_DOCX, "report.docx").unwrap();
        assert!(text.contains("Hello office preview"), "{text}");

        let legacy = extract_office_text_bytes(MINIMAL_DOCX, "report.doc").unwrap_err();
        assert!(legacy.contains("Legacy binary Office format"), "{legacy}");

        let other = extract_office_text_bytes(MINIMAL_DOCX, "notes.txt").unwrap_err();
        assert!(other.contains("Unsupported office extension"), "{other}");
    }
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

    let img =
        image::load_from_memory(&bytes).map_err(|e| format!("Failed to decode image: {}", e))?;
    let rgba = img.to_rgba8();
    let (w, h) = {
        use image::GenericImageView;
        img.dimensions()
    };

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: Cow::from(rgba.into_raw()),
        })
        .map_err(|e| format!("Failed to copy image: {}", e))?;

    Ok(())
}
