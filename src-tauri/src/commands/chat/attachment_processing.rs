//! File and image attachment processing

use super::super::AppState;
use crate::llm::{FileData, ImageData};
use crate::models::CreateFileAttachmentRequest;
use tauri::Emitter;

use super::types::{FileAttachmentInput, ImageAttachmentInput};

/// Parsed image data with filename
pub(crate) struct ParsedImage {
    pub name: String,
    pub data: ImageData,
}

/// An image persisted for the current turn: display name plus the
/// attachments-relative storage path (`files/<hash>.<ext>`). Consumed by the
/// streaming strip path to annotate the LLM projection with readable paths.
pub(crate) struct StoredImage {
    pub name: String,
    pub storage_path: String,
}

/// A persisted file attachment. The vector returned by
/// [`store_file_attachments`] is aligned with the input files; `None` marks
/// a persistence failure (the file cannot be referenced by path).
pub(crate) struct StoredFile {
    pub storage_path: String,
}

/// Parse image attachments from frontend input
pub(crate) fn parse_image_attachments(
    images: Option<Vec<ImageAttachmentInput>>,
) -> Vec<ParsedImage> {
    let mut user_images = Vec::new();

    if let Some(images) = images
        && !images.is_empty()
    {
        tracing::info!(
            "🖼️  [attachment] Processing {} image attachments",
            images.len()
        );
        for img in images.iter() {
            let (media_type, base64_data) = if let Some(rest) = img.base64.strip_prefix("data:") {
                match rest.split_once(";base64,") {
                    Some((mt, b64)) => (mt.to_string(), b64.to_string()),
                    None => {
                        tracing::warn!(
                            "🖼️  [attachment] Malformed data URL for {}, skipping",
                            img.name
                        );
                        continue;
                    }
                }
            } else {
                (img.mime_type.clone(), img.base64.clone())
            };

            let base64_len = base64_data.len();
            tracing::info!(
                "   - Parsed image: {} - {} ({} chars)",
                img.name,
                media_type,
                base64_len
            );
            user_images.push(ParsedImage {
                name: img.name.clone(),
                data: ImageData {
                    base64: base64_data,
                    media_type,
                },
            });
        }
    }

    user_images
}

/// Parse file attachments from frontend input
pub(crate) fn parse_file_attachments(files: Option<Vec<FileAttachmentInput>>) -> Vec<FileData> {
    let mut user_files = Vec::new();

    if let Some(files) = files
        && !files.is_empty()
    {
        tracing::info!(
            "📄 [attachment] Processing {} file attachments",
            files.len()
        );
        for file in files.iter() {
            // Binary documents arrive as base64: decoding here keeps the
            // bytes intact all the way to the persisted attachment, where
            // the read tool can parse the container.
            let bytes = match file.base64.as_deref() {
                Some(encoded) => {
                    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
                    match BASE64.decode(encoded) {
                        Ok(bytes) => Some(bytes),
                        Err(e) => {
                            tracing::error!(
                                "📄 [attachment] Invalid base64 for {}: {}",
                                file.name,
                                e
                            );
                            continue;
                        }
                    }
                }
                None => None,
            };
            let binary = bytes.is_some();
            let stored_size = bytes.as_ref().map(Vec::len).unwrap_or(file.content.len());
            user_files.push(FileData {
                name: file.name.clone(),
                content: if binary {
                    String::new()
                } else {
                    file.content.clone()
                },
                media_type: file.mime_type.clone(),
                bytes,
            });
            tracing::info!(
                "   - File: {} ({} bytes/chars, {}, binary={})",
                file.name,
                stored_size,
                file.mime_type,
                binary
            );
        }
    }

    user_files
}

/// Store file attachments to filesystem and database (with deduplication)
pub(crate) async fn store_file_attachments(
    state: &AppState,
    app: &tauri::AppHandle,
    files: &[FileData],
    user_message_id: &str,
    conversation_id: &str,
) -> Vec<Option<StoredFile>> {
    let mut stored = Vec::with_capacity(files.len());

    for file in files {
        // Hash the stored representation: raw bytes for binary documents,
        // text for everything else.
        let (content_hash, stored_len) = match &file.bytes {
            Some(bytes) => (crate::storage::hash_bytes(bytes), bytes.len()),
            None => (
                crate::storage::hash_content(&file.content),
                file.content.len(),
            ),
        };

        // Check if we already have this content (deduplication)
        if let Ok(Some(existing)) = state.db.find_file_by_hash(&content_hash).await {
            tracing::info!(
                "♻️ [dedup] Reusing existing file content for {} (hash: {}...)",
                file.name,
                &content_hash[..16]
            );

            // Create new file record pointing to existing storage
            match state
                .db
                .create_file_attachment(CreateFileAttachmentRequest {
                    file_name: file.name.clone(),
                    file_size: stored_len as i64,
                    mime_type: file.media_type.clone(),
                    storage_path: existing.storage_path.clone(),
                    content_hash: content_hash.clone(),
                })
                .await
            {
                Ok(file_attachment) => {
                    stored.push(Some(StoredFile {
                        storage_path: existing.storage_path.clone(),
                    }));
                    // Link file to message (user attachment)
                    if let Err(e) = state
                        .db
                        .link_message_attachment(user_message_id, &file_attachment.id, None)
                        .await
                    {
                        tracing::error!("Failed to link file to message: {}", e);
                    } else {
                        tracing::info!(
                            "📎 [attachment] Saved file attachment (dedup): {} -> {}",
                            file.name,
                            file_attachment.id
                        );

                        let _ = app.emit(
                            "attachment-update",
                            serde_json::json!({
                                "message_id": user_message_id,
                                "conversation_id": conversation_id,
                                "attachment_id": file_attachment.id,
                            }),
                        );
                    }
                }
                Err(e) => {
                    stored.push(None);
                    tracing::error!("Failed to create file record for {}: {}", file.name, e);
                }
            }
            continue;
        }

        // Get extension from filename. PDF attachments carry extracted text,
        // so store them as `.txt`: the read tool must be able to open the
        // persisted file directly when the model fetches it on demand.
        let ext = std::path::Path::new(&file.name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("txt");
        let ext = if file.media_type.eq_ignore_ascii_case("application/pdf") {
            "txt"
        } else {
            ext
        };

        // Generate storage path using content hash for deduplication
        let storage_path = crate::storage::generate_file_storage_path(&content_hash, ext);

        // Write file content to filesystem
        let write_result = match &file.bytes {
            Some(bytes) => crate::storage::write_binary(app, &storage_path, bytes),
            None => crate::storage::write_content(app, &storage_path, &file.content),
        };
        if let Err(e) = write_result {
            stored.push(None);
            tracing::error!("Failed to save file {}: {}", file.name, e);
            continue;
        }

        // Create file record in database
        match state
            .db
            .create_file_attachment(CreateFileAttachmentRequest {
                file_name: file.name.clone(),
                file_size: stored_len as i64,
                mime_type: file.media_type.clone(),
                storage_path: storage_path.clone(),
                content_hash: content_hash.clone(),
            })
            .await
        {
            Ok(file_attachment) => {
                stored.push(Some(StoredFile {
                    storage_path: storage_path.clone(),
                }));
                // Link file to message (user attachment)
                if let Err(e) = state
                    .db
                    .link_message_attachment(user_message_id, &file_attachment.id, None)
                    .await
                {
                    tracing::error!("Failed to link file to message: {}", e);
                } else {
                    tracing::info!(
                        "📎 [attachment] Saved file attachment: {} -> {}",
                        file.name,
                        file_attachment.id
                    );

                    // Emit attachment-update so UI refreshes and shows the file
                    let _ = app.emit(
                        "attachment-update",
                        serde_json::json!({
                            "message_id": user_message_id,
                            "conversation_id": conversation_id,
                            "attachment_id": file_attachment.id,
                        }),
                    );
                }
            }
            Err(e) => {
                stored.push(None);
                tracing::error!("Failed to create file record for {}: {}", file.name, e);
                let _ = crate::storage::delete_file(app, &storage_path);
            }
        }
    }

    stored
}

/// Store image attachments to filesystem and database (with deduplication).
/// Returns the images that were stored (name + relative storage path), in
/// input order; images that failed to persist are skipped.
pub(crate) async fn store_image_attachments(
    state: &AppState,
    app: &tauri::AppHandle,
    images: &[ParsedImage],
    user_message_id: &str,
    conversation_id: &str,
) -> Vec<StoredImage> {
    let mut stored = Vec::new();
    for image in images {
        let file_name = &image.name;
        let img = &image.data;

        // Decode base64 to bytes first (needed for hashing)
        let bytes =
            match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &img.base64) {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!("Failed to decode image {}: {}", file_name, e);
                    continue;
                }
            };

        // Hash image bytes for deduplication
        let content_hash = crate::storage::hash_bytes(&bytes);

        // Check if we already have this image (deduplication)
        if let Ok(Some(existing)) = state.db.find_file_by_hash(&content_hash).await {
            tracing::info!(
                "♻️ [dedup] Reusing existing image content for {} (hash: {}...)",
                file_name,
                &content_hash[..16]
            );

            // Create new file record pointing to existing storage
            match state
                .db
                .create_file_attachment(CreateFileAttachmentRequest {
                    file_name: file_name.clone(),
                    file_size: bytes.len() as i64,
                    mime_type: img.media_type.clone(),
                    storage_path: existing.storage_path.clone(),
                    content_hash: content_hash.clone(),
                })
                .await
            {
                Ok(file_attachment) => {
                    // Link file (image) to message (user attachment)
                    if let Err(e) = state
                        .db
                        .link_message_attachment(user_message_id, &file_attachment.id, None)
                        .await
                    {
                        tracing::error!("Failed to link image to message: {}", e);
                    } else {
                        tracing::info!(
                            "🖼️ [attachment] Saved image attachment (dedup): {} -> {}",
                            file_name,
                            file_attachment.id
                        );

                        let _ = app.emit(
                            "attachment-update",
                            serde_json::json!({
                                "message_id": user_message_id,
                                "conversation_id": conversation_id,
                                "attachment_id": file_attachment.id,
                            }),
                        );
                        stored.push(StoredImage {
                            name: file_name.clone(),
                            storage_path: existing.storage_path.clone(),
                        });
                    }
                }
                Err(e) => {
                    tracing::error!(
                        "Failed to create file record for image {}: {}",
                        file_name,
                        e
                    );
                }
            }
            continue;
        }

        // Get extension from mime type
        let ext = crate::storage::get_extension_for_content_type(&img.media_type);

        // Generate storage path using content hash for deduplication
        let storage_path = crate::storage::generate_file_storage_path(&content_hash, ext);

        // Write image to filesystem
        if let Err(e) = crate::storage::write_binary(app, &storage_path, &bytes) {
            tracing::error!("Failed to save image {}: {}", file_name, e);
            continue;
        }

        // Create file record in database with original filename
        match state
            .db
            .create_file_attachment(CreateFileAttachmentRequest {
                file_name: file_name.clone(),
                file_size: bytes.len() as i64,
                mime_type: img.media_type.clone(),
                storage_path: storage_path.clone(),
                content_hash: content_hash.clone(),
            })
            .await
        {
            Ok(file_attachment) => {
                // Link file (image) to message (user attachment)
                if let Err(e) = state
                    .db
                    .link_message_attachment(user_message_id, &file_attachment.id, None)
                    .await
                {
                    tracing::error!("Failed to link image to message: {}", e);
                } else {
                    tracing::info!(
                        "🖼️ [attachment] Saved image attachment: {} -> {}",
                        file_name,
                        file_attachment.id
                    );

                    // Emit attachment-update so UI refreshes and shows the image
                    let _ = app.emit(
                        "attachment-update",
                        serde_json::json!({
                            "message_id": user_message_id,
                            "conversation_id": conversation_id,
                            "attachment_id": file_attachment.id,
                        }),
                    );
                    stored.push(StoredImage {
                        name: file_name.clone(),
                        storage_path: storage_path.clone(),
                    });
                }
            }
            Err(e) => {
                tracing::error!(
                    "Failed to create file record for image {}: {}",
                    file_name,
                    e
                );
                let _ = crate::storage::delete_file(app, &storage_path);
            }
        }
    }
    stored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, content: &str, base64: Option<&str>) -> FileAttachmentInput {
        FileAttachmentInput {
            name: name.to_string(),
            content: content.to_string(),
            base64: base64.map(str::to_string),
            mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                .to_string(),
        }
    }

    #[test]
    fn base64_documents_keep_raw_bytes_and_no_text() {
        // "AAEC" = [0x00, 0x01, 0x02]
        let files = parse_file_attachments(Some(vec![input("report.docx", "", Some("AAEC"))]));

        assert_eq!(files.len(), 1);
        assert!(files[0].content.is_empty());
        assert_eq!(files[0].bytes.as_deref(), Some(&[0u8, 1, 2][..]));
    }

    #[test]
    fn text_files_carry_no_raw_bytes() {
        let files = parse_file_attachments(Some(vec![input("notes.md", "# hi", None)]));

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].content, "# hi");
        assert!(files[0].bytes.is_none());
    }
}
