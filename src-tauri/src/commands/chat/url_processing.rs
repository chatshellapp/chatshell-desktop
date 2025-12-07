//! URL fetching and storage logic

use super::super::AppState;
use crate::models::{ContextType, CreateFetchResultRequest};
use crate::web_fetch::{self, FetchedWebResource};
use tauri::Emitter;

/// Result of URL processing
pub(crate) struct UrlProcessingResult {
    pub fetched_resources: Vec<FetchedWebResource>,
    pub attachment_ids: Vec<String>,
}

/// Fetch and store URLs, emitting events as each completes
pub(crate) async fn fetch_and_store_urls(
    state: &AppState,
    app: &tauri::AppHandle,
    urls: &[String],
    user_message_id: &str,
    conversation_id: &str,
    search_result_id: Option<&str>,
) -> UrlProcessingResult {
    if urls.is_empty() {
        return UrlProcessingResult {
            fetched_resources: Vec::new(),
            attachment_ids: Vec::new(),
        };
    }

    println!("🔍 [url_processing] Processing {} URLs", urls.len());
    let _ = app.emit(
        "attachment-processing-started",
        serde_json::json!({
            "message_id": user_message_id,
            "conversation_id": conversation_id,
            "urls": urls,
        }),
    );

    // Process URLs with streaming - results are sent one by one as they complete
    let (mut rx, fetch_handle) = web_fetch::fetch_urls_with_channel(urls, None).await;

    let mut fetched_resources: Vec<FetchedWebResource> = Vec::new();
    let mut attachment_ids: Vec<String> = Vec::new();

    // Process each result as it arrives from the channel
    while let Some(resource) = rx.recv().await {
        let content_hash = crate::storage::hash_content(&resource.content);

        // Check if we already have this content (deduplication)
        if let Ok(Some(existing)) = state.db.find_fetch_by_hash(&content_hash).await {
            println!(
                "♻️ [dedup] Reusing existing fetch content for {} (hash: {}...)",
                resource.url,
                &content_hash[..16]
            );

            // Link existing fetch_result to this message
            if let Err(e) = state
                .db
                .link_message_context(user_message_id, ContextType::FetchResult, &existing.id, None)
                .await
            {
                eprintln!("Failed to link existing fetch_result to message: {}", e);
            }

            // Emit attachment-update immediately so UI shows this result
            let _ = app.emit(
                "attachment-update",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id,
                    "attachment_id": existing.id,
                    "completed_url": resource.url,
                }),
            );

            attachment_ids.push(existing.id);
            fetched_resources.push(resource);
            continue;
        }

        // Generate storage path using content hash for deduplication
        let storage_path =
            crate::storage::generate_fetch_storage_path(&content_hash, &resource.content_format);

        // Save content to filesystem (hash-based path)
        if let Err(e) = crate::storage::write_content(app, &storage_path, &resource.content) {
            eprintln!(
                "Failed to save content to filesystem for {}: {}",
                resource.url, e
            );
            fetched_resources.push(resource);
            continue;
        }

        let status = if resource.extraction_error.is_some() {
            "failed"
        } else {
            "success"
        };
        let headings_json = serde_json::to_string(&resource.metadata.headings).ok();
        let content_size = resource.content.len() as i64;

        // Determine source type
        let (source_type, source_id) = if search_result_id.is_some() {
            ("search".to_string(), search_result_id.map(|s| s.to_string()))
        } else {
            ("user_link".to_string(), None)
        };

        match state
            .db
            .create_fetch_result(CreateFetchResultRequest {
                source_type: Some(source_type),
                source_id,
                url: resource.url.clone(),
                title: resource.title.clone(),
                description: resource.description.clone(),
                storage_path: storage_path.clone(),
                content_type: resource.content_format.clone(),
                original_mime: Some(resource.mime_type.clone()),
                status: Some(status.to_string()),
                error: resource.extraction_error.clone(),
                keywords: resource.metadata.keywords.clone(),
                headings: headings_json,
                original_size: resource.metadata.original_length.map(|l| l as i64),
                processed_size: Some(content_size),
                favicon_url: resource.metadata.favicon_url.clone(),
                content_hash: Some(content_hash.clone()),
            })
            .await
        {
            Ok(fetch_result) => {
                // Link fetch_result to message as context enrichment
                if let Err(e) = state
                    .db
                    .link_message_context(
                        user_message_id,
                        ContextType::FetchResult,
                        &fetch_result.id,
                        None,
                    )
                    .await
                {
                    eprintln!("Failed to link fetch_result to message: {}", e);
                }

                // Emit attachment-update immediately so UI shows this result
                let _ = app.emit(
                    "attachment-update",
                    serde_json::json!({
                        "message_id": user_message_id,
                        "conversation_id": conversation_id,
                        "attachment_id": fetch_result.id,
                        "completed_url": resource.url,
                    }),
                );

                attachment_ids.push(fetch_result.id);
            }
            Err(e) => {
                eprintln!("Failed to create fetch_result for {}: {}", resource.url, e);
                // Clean up saved file on failure
                let _ = crate::storage::delete_file(app, &storage_path);
            }
        }

        fetched_resources.push(resource);
    }

    // Wait for all fetches to complete
    let _ = fetch_handle.await;

    println!(
        "📄 [url_processing] Fetched {} web resources",
        fetched_resources.len()
    );

    // Emit attachment processing complete event with attachment IDs
    let _ = app.emit(
        "attachment-processing-complete",
        serde_json::json!({
            "message_id": user_message_id,
            "conversation_id": conversation_id,
            "attachment_ids": attachment_ids,
        }),
    );

    UrlProcessingResult {
        fetched_resources,
        attachment_ids,
    }
}

