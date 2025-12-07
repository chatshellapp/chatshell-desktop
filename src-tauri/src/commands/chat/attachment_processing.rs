//! File and image attachment processing

use super::super::AppState;
use crate::llm::{FileData, ImageData};
use crate::models::{CreateFileAttachmentRequest, UserAttachmentType};
use tauri::Emitter;

use super::types::{FileAttachmentInput, ImageAttachmentInput};

/// Parsed image data with filename
pub(crate) struct ParsedImage {
    pub name: String,
    pub data: ImageData,
}

/// Parse image attachments from frontend input
pub(crate) fn parse_image_attachments(
    images: Option<Vec<ImageAttachmentInput>>,
) -> Vec<ParsedImage> {
    let mut user_images = Vec::new();

    if let Some(images) = images {
        if !images.is_empty() {
            println!(
                "🖼️  [attachment] Processing {} image attachments",
                images.len()
            );
            for img in images.iter() {
                // Parse data URL: "data:image/png;base64,xxxxx"
                if let Some(rest) = img.base64.strip_prefix("data:") {
                    if let Some((media_type, base64_data)) = rest.split_once(";base64,") {
                        user_images.push(ParsedImage {
                            name: img.name.clone(),
                            data: ImageData {
                                base64: base64_data.to_string(),
                                media_type: media_type.to_string(),
                            },
                        });
                        println!(
                            "   - Parsed image: {} - {} ({} chars)",
                            img.name,
                            media_type,
                            base64_data.len()
                        );
                    }
                }
            }
        }
    }

    user_images
}

/// Parse file attachments from frontend input
pub(crate) fn parse_file_attachments(files: Option<Vec<FileAttachmentInput>>) -> Vec<FileData> {
    let mut user_files = Vec::new();

    if let Some(files) = files {
        if !files.is_empty() {
            println!(
                "📄 [attachment] Processing {} file attachments",
                files.len()
            );
            for file in files.iter() {
                user_files.push(FileData {
                    name: file.name.clone(),
                    content: file.content.clone(),
                    media_type: file.mime_type.clone(),
                });
                println!(
                    "   - File: {} ({} chars, {})",
                    file.name,
                    file.content.len(),
                    file.mime_type
                );
            }
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
) {
    for file in files {
        // Hash file content for deduplication
        let content_hash = crate::storage::hash_content(&file.content);

        // Check if we already have this content (deduplication)
        if let Ok(Some(existing)) = state.db.find_file_by_hash(&content_hash).await {
            println!(
                "♻️ [dedup] Reusing existing file content for {} (hash: {}...)",
                file.name,
                &content_hash[..16]
            );

            // Create new file record pointing to existing storage
            match state
                .db
                .create_file_attachment(CreateFileAttachmentRequest {
                    file_name: file.name.clone(),
                    file_size: file.content.len() as i64,
                    mime_type: file.media_type.clone(),
                    storage_path: existing.storage_path.clone(),
                    content_hash: content_hash.clone(),
                })
                .await
            {
                Ok(file_attachment) => {
                    // Link file to message (user attachment)
                    if let Err(e) = state
                        .db
                        .link_message_attachment(
                            user_message_id,
                            UserAttachmentType::File,
                            &file_attachment.id,
                            None,
                        )
                        .await
                    {
                        eprintln!("Failed to link file to message: {}", e);
                    } else {
                        println!(
                            "📎 [attachment] Saved file attachment (dedup): {} -> {}",
                            file.name, file_attachment.id
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
                    eprintln!("Failed to create file record for {}: {}", file.name, e);
                }
            }
            continue;
        }

        // Get extension from filename
        let ext = std::path::Path::new(&file.name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("txt");

        // Generate storage path using content hash for deduplication
        let storage_path = crate::storage::generate_file_storage_path(&content_hash, ext);

        // Write file content to filesystem
        if let Err(e) = crate::storage::write_content(app, &storage_path, &file.content) {
            eprintln!("Failed to save file {}: {}", file.name, e);
            continue;
        }

        // Create file record in database
        match state
            .db
            .create_file_attachment(CreateFileAttachmentRequest {
                file_name: file.name.clone(),
                file_size: file.content.len() as i64,
                mime_type: file.media_type.clone(),
                storage_path: storage_path.clone(),
                content_hash: content_hash.clone(),
            })
            .await
        {
            Ok(file_attachment) => {
                // Link file to message (user attachment)
                if let Err(e) = state
                    .db
                    .link_message_attachment(
                        user_message_id,
                        UserAttachmentType::File,
                        &file_attachment.id,
                        None,
                    )
                    .await
                {
                    eprintln!("Failed to link file to message: {}", e);
                } else {
                    println!(
                        "📎 [attachment] Saved file attachment: {} -> {}",
                        file.name, file_attachment.id
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
                eprintln!("Failed to create file record for {}: {}", file.name, e);
                let _ = crate::storage::delete_file(app, &storage_path);
            }
        }
    }
}

/// Store image attachments to filesystem and database (with deduplication)
pub(crate) async fn store_image_attachments(
    state: &AppState,
    app: &tauri::AppHandle,
    images: &[ParsedImage],
    user_message_id: &str,
    conversation_id: &str,
) {
    for image in images {
        let file_name = &image.name;
        let img = &image.data;

        // Decode base64 to bytes first (needed for hashing)
        let bytes = match base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &img.base64,
        ) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("Failed to decode image {}: {}", file_name, e);
                continue;
            }
        };

        // Hash image bytes for deduplication
        let content_hash = crate::storage::hash_bytes(&bytes);

        // Check if we already have this image (deduplication)
        if let Ok(Some(existing)) = state.db.find_file_by_hash(&content_hash).await {
            println!(
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
                        .link_message_attachment(
                            user_message_id,
                            UserAttachmentType::File,
                            &file_attachment.id,
                            None,
                        )
                        .await
                    {
                        eprintln!("Failed to link image to message: {}", e);
                    } else {
                        println!(
                            "🖼️ [attachment] Saved image attachment (dedup): {} -> {}",
                            file_name, file_attachment.id
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
                    eprintln!("Failed to create file record for image {}: {}", file_name, e);
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
            eprintln!("Failed to save image {}: {}", file_name, e);
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
                    .link_message_attachment(
                        user_message_id,
                        UserAttachmentType::File,
                        &file_attachment.id,
                        None,
                    )
                    .await
                {
                    eprintln!("Failed to link image to message: {}", e);
                } else {
                    println!(
                        "🖼️ [attachment] Saved image attachment: {} -> {}",
                        file_name, file_attachment.id
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
                }
            }
            Err(e) => {
                eprintln!("Failed to create file record for image {}: {}", file_name, e);
                let _ = crate::storage::delete_file(app, &storage_path);
            }
        }
    }
}

