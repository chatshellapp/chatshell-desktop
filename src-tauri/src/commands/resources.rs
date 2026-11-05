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
    // Stored PDFs keep their original bytes; preview their text layer.
    if storage_path.to_ascii_lowercase().ends_with(".pdf") {
        let bytes = crate::storage::read_binary(&app, &storage_path).map_err(|e| e.to_string())?;
        if bytes.starts_with(b"%PDF-") {
            return chatshell_agent_core::pdf_text::extract_pdf_text(&bytes)
                .map_err(|e| format!("Failed to extract PDF text: {}", e));
        }
    }
    crate::storage::read_content(&app, &storage_path).map_err(|e| e.to_string())
}

// Read arbitrary text file from filesystem (for files selected via dialog)
#[tauri::command]
pub async fn read_text_file_from_path(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

/// Size in bytes of a file selected via the native dialog, so the
/// composer can refuse oversized attachments before reading them.
#[tauri::command]
pub async fn get_path_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|meta| meta.len())
        .map_err(|e| format!("Failed to read file {}: {}", path, e))
}

/// Entries listed for an attached folder.
const FOLDER_LISTING_MAX_ENTRIES: usize = 500;
/// Byte ceiling of an attached folder listing.
const FOLDER_LISTING_MAX_BYTES: usize = 50 * 1024;

/// A one-level listing of a folder the user attached. Folders are never
/// expanded recursively into context: the listing names the absolute path
/// so the model can go deeper with glob, bash, and read. Attaching a
/// folder grants nothing and does not change the working directory.
#[tauri::command]
pub async fn list_folder_for_attachment(path: String) -> Result<String, String> {
    let dir = std::path::Path::new(&path);
    if let Some(block) = chatshell_agent_core::path_policy::classify_read(dir)
        && block.tier == chatshell_agent_core::path_policy::ReadTier::Deny
    {
        return Err(block.message());
    }
    let mut entries: Vec<(bool, String, u64)> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to list folder {}: {}", path, e))?
        .filter_map(|entry| entry.ok())
        .map(|entry| {
            let meta = entry.metadata().ok();
            let is_dir = meta.as_ref().is_some_and(|m| m.is_dir());
            let size = meta.map(|m| m.len()).unwrap_or(0);
            (
                is_dir,
                entry.file_name().to_string_lossy().into_owned(),
                size,
            )
        })
        .collect();
    Ok(render_folder_listing(&path, &mut entries))
}

/// Folders first, then files, each sorted by name.
fn render_folder_listing(path: &str, entries: &mut [(bool, String, u64)]) -> String {
    entries.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase()))
    });
    let total = entries.len();
    let mut body = String::new();
    let mut shown = 0usize;
    for (is_dir, name, size) in entries.iter() {
        let line = if *is_dir {
            format!("{name}/\n")
        } else {
            format!("{name}  ({})\n", human_size(*size))
        };
        if shown >= FOLDER_LISTING_MAX_ENTRIES || body.len() + line.len() > FOLDER_LISTING_MAX_BYTES
        {
            break;
        }
        body.push_str(&line);
        shown += 1;
    }
    let more = if shown < total {
        format!(" (showing the first {shown}; use glob or bash `ls` on the folder for the rest)")
    } else {
        String::new()
    };
    format!(
        "Folder: {path}\n\
         Attached by the user as a one-level listing. It is not the working directory and \
         grants no extra access. Folders end with \"/\". Use glob or bash (ls, find) on this \
         absolute path for deeper levels, and read for file contents.\n\
         {total} entries{more}:\n\n{body}"
    )
}

fn human_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// Files offered by the composer's @-mention picker.
const MENTION_MAX_FILES: usize = 20_000;

/// Files under `root` (the conversation's working directory) for the
/// composer's @-mention picker: gitignore-aware, hidden files skipped,
/// relative paths sorted. Read-blocked files are left out.
#[tauri::command]
pub async fn list_mention_candidates(root: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || mention_candidates(std::path::Path::new(&root)))
        .await
        .map_err(|e| e.to_string())?
}

fn mention_candidates(root: &std::path::Path) -> Result<Vec<String>, String> {
    use chatshell_agent_core::path_policy::{ReadClassifier, ReadTier};
    use chatshell_agent_core::tool_fs::{Fs, StdFs, WalkFilters};

    let classifier = ReadClassifier::new();
    if let Some(block) = classifier.classify(root)
        && block.tier == ReadTier::Deny
    {
        return Err(block.message());
    }
    let filters = WalkFilters {
        max_files: Some(MENTION_MAX_FILES),
        ..WalkFilters::default()
    };
    let files = StdFs
        .walk(root, &filters)
        .map_err(|e| format!("Failed to list {}: {}", root.display(), e))?;
    let mut relative: Vec<String> = files
        .into_iter()
        .filter(|path| {
            classifier
                .classify_lexical(path)
                .is_none_or(|block| block.tier != ReadTier::Deny)
        })
        .filter_map(|path| {
            path.strip_prefix(root)
                .ok()
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        })
        .filter(|rel| !rel.is_empty())
        .collect();
    relative.sort();
    Ok(relative)
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
    // An empty or near-empty text layer is not an error: the original
    // PDF travels with the attachment, and the read tool returns the page
    // images of scanned pages.
    chatshell_agent_core::pdf_text::extract_pdf_text(bytes)
        .map_err(|e| format!("Failed to extract PDF text: {}", e))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mention_candidates_are_relative_sorted_and_gitignore_aware() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("target")).unwrap();
        std::fs::write(root.join(".gitignore"), "target/\n").unwrap();
        std::fs::write(root.join("src/main.rs"), "").unwrap();
        std::fs::write(root.join("README.md"), "").unwrap();
        std::fs::write(root.join("target/out.bin"), "").unwrap();
        std::fs::write(root.join(".env"), "SECRET=1").unwrap();
        // gitignore applies inside git repositories.
        std::fs::create_dir_all(root.join(".git")).unwrap();

        let files = mention_candidates(root).unwrap();
        assert_eq!(
            files,
            vec!["README.md".to_string(), "src/main.rs".to_string()]
        );
    }

    #[test]
    fn folder_listing_puts_folders_first_and_caps_entries() {
        let mut entries = vec![
            (false, "b.txt".to_string(), 2048),
            (true, "src".to_string(), 0),
            (false, "A.md".to_string(), 10),
        ];
        let listing = render_folder_listing("/work/proj", &mut entries);
        assert!(listing.starts_with("Folder: /work/proj\n"), "{listing}");
        assert!(listing.contains("3 entries:"), "{listing}");
        let body = listing.split("\n\n").nth(1).unwrap();
        assert_eq!(body, "src/\nA.md  (10 B)\nb.txt  (2.0 KB)\n");

        let mut many: Vec<_> = (0..700).map(|i| (false, format!("f{i:04}"), 1)).collect();
        let listing = render_folder_listing("/x", &mut many);
        assert!(
            listing.contains("700 entries (showing the first 500"),
            "{}",
            &listing[..300]
        );
    }

    #[tokio::test]
    async fn folder_listing_reads_a_real_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("x.rs"), "fn main() {}").unwrap();
        let listing = list_folder_for_attachment(dir.path().display().to_string())
            .await
            .unwrap();
        assert!(listing.contains("sub/\nx.rs  (12 B)"), "{listing}");
        assert!(
            list_folder_for_attachment("/definitely/not/here".to_string())
                .await
                .is_err()
        );
    }
}
