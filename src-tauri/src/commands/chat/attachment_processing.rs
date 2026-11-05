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

            let _ = media_type; // sniffed from the bytes instead
            let Some(data) = fit_for_provider(&img.name, base64_data) else {
                continue;
            };
            tracing::info!(
                "   - Parsed image: {} - {} ({} chars)",
                img.name,
                data.media_type,
                data.base64.len()
            );
            user_images.push(ParsedImage {
                name: img.name.clone(),
                data,
            });
        }
    }

    user_images
}

/// Apply the provider image limits (`chatshell_agent_core::image_fit`). The frontend already
/// fits images at attach time; this is the floor for anything that slipped
/// through. Undecodable images are dropped with an error log.
fn fit_for_provider(name: &str, base64_data: String) -> Option<ImageData> {
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
    let bytes = match BASE64.decode(&base64_data) {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::error!("🖼️  [attachment] Invalid base64 for {}: {}", name, e);
            return None;
        }
    };
    fit_bytes_for_provider(name, &bytes, Some(base64_data))
}

/// [`fit_for_provider`] over raw bytes; `original_base64` is reused when
/// the image passes through unchanged.
fn fit_bytes_for_provider(
    name: &str,
    bytes: &[u8],
    original_base64: Option<String>,
) -> Option<ImageData> {
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
    match chatshell_agent_core::image_fit::fit_image(bytes) {
        Ok(fitted) if !fitted.changed => Some(ImageData {
            base64: original_base64.unwrap_or_else(|| BASE64.encode(bytes)),
            media_type: fitted.mime_type,
        }),
        Ok(fitted) => {
            tracing::info!(
                "🖼️  [attachment] Fitted {} to {}x{} {} ({} -> {} bytes)",
                name,
                fitted.width,
                fitted.height,
                fitted.mime_type,
                bytes.len(),
                fitted.bytes.len()
            );
            Some(ImageData {
                base64: BASE64.encode(&fitted.bytes),
                media_type: fitted.mime_type,
            })
        }
        Err(e) => {
            tracing::error!("🖼️  [attachment] Dropping image {}: {}", name, e);
            None
        }
    }
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
            // PDFs carry both: the original bytes (persisted, paged by the
            // read tool) and their extracted text layer (projected).
            user_files.push(FileData {
                name: file.name.clone(),
                content: file.content.clone(),
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

        // Get extension from filename. A PDF that arrived as text only
        // (no original bytes) is stored as `.txt` so the read tool opens
        // it as text; with its bytes it stays a `.pdf` (paged reads, page
        // images for scans).
        let pdf = file.media_type.eq_ignore_ascii_case("application/pdf");
        let ext = match (pdf, file.bytes.is_some()) {
            (true, true) => "pdf",
            (true, false) => "txt",
            _ => std::path::Path::new(&file.name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("txt"),
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

/// A user turn's attachments rebuilt from storage, shaped exactly like a
/// fresh send after parse + store. Regenerate projects these so a retried
/// turn sends the same images and files the user originally attached.
#[derive(Default)]
pub(crate) struct PersistedTurn {
    pub images: Vec<ParsedImage>,
    pub stored_images: Vec<StoredImage>,
    pub files: Vec<FileData>,
    pub stored_files: Vec<Option<StoredFile>>,
}

/// How a stored attachment re-enters the projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PersistedKind {
    Image,
    /// Raw container bytes (Office documents, videos); the read tool parses them.
    BinaryDocument,
    /// Original PDF bytes; the text layer is extracted again for projection.
    Pdf,
    /// Text content (code, markdown, extracted PDF text).
    Text,
}

fn persisted_kind(mime_type: &str, storage_path: &str) -> PersistedKind {
    if mime_type.to_ascii_lowercase().starts_with("image/") {
        return PersistedKind::Image;
    }
    let ext = std::path::Path::new(storage_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if chatshell_agent_core::office::is_office_extension(&ext)
        || chatshell_agent_core::video::is_video_extension(&ext)
    {
        PersistedKind::BinaryDocument
    } else if ext == "pdf" {
        PersistedKind::Pdf
    } else {
        PersistedKind::Text
    }
}

/// Load the attachments linked to `message_id` from storage. Files whose
/// bytes are missing locally (not yet fetched by sync) are skipped with a
/// warning; the history manifest still lists them.
pub(crate) async fn load_persisted_turn(
    db: &crate::db::Database,
    attachments_dir: &std::path::Path,
    message_id: &str,
) -> PersistedTurn {
    let attachments = match db.get_message_attachments(message_id).await {
        Ok(attachments) => attachments,
        Err(e) => {
            tracing::error!("Failed to load attachments of {}: {}", message_id, e);
            return PersistedTurn::default();
        }
    };

    let mut turn = PersistedTurn::default();
    for attachment in attachments {
        let crate::models::UserAttachment::File(file) = attachment;
        let kind = persisted_kind(&file.mime_type, &file.storage_path);
        let loaded = match kind {
            PersistedKind::Image | PersistedKind::BinaryDocument | PersistedKind::Pdf => {
                std::fs::read(attachments_dir.join(&file.storage_path)).map(Some)
            }
            PersistedKind::Text => {
                std::fs::read_to_string(attachments_dir.join(&file.storage_path)).map(|text| {
                    turn.files.push(FileData {
                        name: file.file_name.clone(),
                        content: text,
                        media_type: file.mime_type.clone(),
                        bytes: None,
                    });
                    None
                })
            }
        };
        let bytes = match loaded {
            Ok(bytes) => bytes,
            Err(e) => {
                tracing::warn!(
                    "📎 [attachment] {} is not available locally ({}); regenerating without it",
                    file.file_name,
                    e
                );
                continue;
            }
        };
        match (kind, bytes) {
            (PersistedKind::Image, Some(bytes)) => {
                let Some(data) = fit_bytes_for_provider(&file.file_name, &bytes, None) else {
                    continue;
                };
                turn.images.push(ParsedImage {
                    name: file.file_name.clone(),
                    data,
                });
                turn.stored_images.push(StoredImage {
                    name: file.file_name.clone(),
                    storage_path: file.storage_path.clone(),
                });
            }
            (kind @ (PersistedKind::BinaryDocument | PersistedKind::Pdf), Some(bytes)) => {
                let content = if kind == PersistedKind::Pdf {
                    chatshell_agent_core::pdf_text::extract_pdf_text(&bytes).unwrap_or_default()
                } else {
                    String::new()
                };
                turn.files.push(FileData {
                    name: file.file_name.clone(),
                    content,
                    media_type: file.mime_type.clone(),
                    bytes: Some(bytes),
                });
                turn.stored_files.push(Some(StoredFile {
                    storage_path: file.storage_path.clone(),
                }));
            }
            _ => turn.stored_files.push(Some(StoredFile {
                storage_path: file.storage_path.clone(),
            })),
        }
    }
    tracing::info!(
        "📎 [attachment] Reusing {} image(s) and {} file(s) from storage for {}",
        turn.images.len(),
        turn.files.len(),
        message_id
    );
    turn
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

    #[tokio::test]
    async fn persisted_turn_rebuilds_images_and_files_from_storage() {
        use crate::models::CreateMessageRequest;
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at)
             VALUES ('conv', 'test', ?, ?)",
        )
        .bind(&now)
        .bind(&now)
        .execute(db.pool())
        .await
        .unwrap();
        let message = db
            .create_message(CreateMessageRequest {
                conversation_id: Some("conv".to_string()),
                parent_id: None,
                sender_type: "user".to_string(),
                sender_id: None,
                content: "look".to_string(),
                tokens: None,
            })
            .await
            .unwrap();

        let attachments = dir.path().join("attachments");
        std::fs::create_dir_all(attachments.join("files")).unwrap();
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::new(4, 4))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        std::fs::write(attachments.join("files/img.png"), &png).unwrap();
        std::fs::write(attachments.join("files/doc.docx"), [9u8, 9]).unwrap();
        std::fs::write(attachments.join("files/notes.md"), "# notes").unwrap();
        let rows = [
            ("photo.png", "image/png", "files/img.png"),
            (
                "report.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "files/doc.docx",
            ),
            ("notes.md", "text/markdown", "files/notes.md"),
            ("gone.md", "text/markdown", "files/missing.md"),
        ];
        for (order, (name, mime, path)) in rows.iter().enumerate() {
            let file = db
                .create_file_attachment(CreateFileAttachmentRequest {
                    file_name: name.to_string(),
                    file_size: 1,
                    mime_type: mime.to_string(),
                    storage_path: path.to_string(),
                    content_hash: format!("h{order}"),
                })
                .await
                .unwrap();
            db.link_message_attachment(&message.id, &file.id, Some(order as i32))
                .await
                .unwrap();
        }

        let turn = load_persisted_turn(&db, &attachments, &message.id).await;

        assert_eq!(turn.images.len(), 1);
        {
            use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
            assert_eq!(turn.images[0].data.base64, BASE64.encode(&png));
        }
        assert_eq!(turn.images[0].data.media_type, "image/png");
        assert_eq!(turn.stored_images[0].storage_path, "files/img.png");
        // Missing blobs are skipped; files and stored_files stay aligned.
        assert_eq!(turn.files.len(), 2);
        assert_eq!(turn.stored_files.len(), 2);
        assert_eq!(turn.files[0].bytes.as_deref(), Some(&[9u8, 9][..]));
        assert_eq!(turn.files[1].content, "# notes");
        assert_eq!(
            turn.stored_files[1].as_ref().unwrap().storage_path,
            "files/notes.md"
        );
    }

    #[test]
    fn persisted_attachments_reenter_by_kind() {
        assert_eq!(
            persisted_kind("image/png", "files/a.png"),
            PersistedKind::Image
        );
        assert_eq!(
            persisted_kind(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "files/a.docx"
            ),
            PersistedKind::BinaryDocument
        );
        // Text-only PDFs persist as `.txt`; PDFs with bytes as `.pdf`.
        assert_eq!(
            persisted_kind("application/pdf", "files/a.txt"),
            PersistedKind::Text
        );
        assert_eq!(
            persisted_kind("application/pdf", "files/a.pdf"),
            PersistedKind::Pdf
        );
        assert_eq!(
            persisted_kind("text/markdown", "files/a.md"),
            PersistedKind::Text
        );
        assert_eq!(
            persisted_kind("video/mp4", "files/a.mp4"),
            PersistedKind::BinaryDocument
        );
    }

    #[test]
    fn text_files_carry_no_raw_bytes() {
        let files = parse_file_attachments(Some(vec![input("notes.md", "# hi", None)]));

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].content, "# hi");
        assert!(files[0].bytes.is_none());
    }
}
