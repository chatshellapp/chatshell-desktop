//! URL fetching and storage logic

use super::super::AppState;
use crate::models::{ContextType, CreateFetchResultRequest};
use crate::web_fetch::{
    self, FetchConfig, FetchMode, FetchedWebResource, LocalMethod, WebFetchMetadata,
};
use tauri::Emitter;

/// Load fetch configuration from settings
pub(crate) async fn load_fetch_config(state: &AppState) -> FetchConfig {
    let mode = match state.db.get_setting("web_fetch_mode").await {
        Ok(Some(m)) if m == "api" => FetchMode::Api,
        _ => FetchMode::Local,
    };

    let local_method = match state.db.get_setting("web_fetch_local_method").await {
        Ok(Some(m)) => match m.as_str() {
            "fetch" => LocalMethod::FetchOnly,
            "headless" => LocalMethod::ChromeOnly,
            "obscura" => LocalMethod::ObscuraOnly,
            "webview" => LocalMethod::WebViewOnly,
            _ => LocalMethod::Auto,
        },
        _ => LocalMethod::Auto,
    };

    let jina_api_key = state
        .db
        .get_setting("jina_api_key")
        .await
        .ok()
        .flatten()
        .filter(|k| !k.is_empty());

    FetchConfig {
        mode,
        local_method,
        jina_api_key,
    }
}

/// Result of URL processing
pub(crate) struct UrlProcessingResult {
    pub fetched_resources: Vec<FetchedWebResource>,
    pub attachment_ids: Vec<String>,
}

/// Re-link existing fetch_results to the new user message without re-hitting
/// the network. Used by the "resend" path so the LLM sees the same content
/// the user originally attached, even if the URL has since changed or gone
/// offline.
async fn reuse_fetch_results(
    state: &AppState,
    app: &tauri::AppHandle,
    fetch_result_ids: &[String],
    user_message_id: &str,
    conversation_id: &str,
) -> (Vec<FetchedWebResource>, Vec<String>) {
    let mut resources = Vec::new();
    let mut attachment_ids = Vec::new();

    for fetch_result_id in fetch_result_ids {
        let fetch_result = match state.db.get_fetch_result(fetch_result_id).await {
            Ok(fr) => fr,
            Err(e) => {
                tracing::error!(
                    "Failed to load fetch_result {} for reuse: {}",
                    fetch_result_id,
                    e
                );
                continue;
            }
        };

        let content = match crate::storage::read_content(app, &fetch_result.storage_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(
                    "Failed to read reused fetch_result {} from {}: {}",
                    fetch_result_id,
                    fetch_result.storage_path,
                    e
                );
                continue;
            }
        };

        let headings: Vec<String> = fetch_result
            .headings
            .as_deref()
            .and_then(|h| serde_json::from_str(h).ok())
            .unwrap_or_default();

        let mime_type = fetch_result
            .original_mime
            .clone()
            .unwrap_or_else(|| fetch_result.content_type.clone());

        let resource = FetchedWebResource {
            url: fetch_result.url.clone(),
            title: fetch_result.title.clone(),
            description: fetch_result.description.clone(),
            mime_type,
            content_format: fetch_result.content_type.clone(),
            content,
            extraction_error: if fetch_result.status == "failed" {
                fetch_result.error.clone()
            } else {
                None
            },
            metadata: WebFetchMetadata {
                keywords: fetch_result.keywords.clone(),
                headings,
                fetched_at: fetch_result.updated_at.clone(),
                original_length: fetch_result
                    .original_size
                    .and_then(|s| usize::try_from(s).ok()),
                truncated: false,
                favicon_url: fetch_result.favicon_url.clone(),
                tier: None,
                escalated: false,
                partial: false,
            },
        };

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
            tracing::error!(
                "Failed to link reused fetch_result {} to message: {}",
                fetch_result_id,
                e
            );
            continue;
        }

        tracing::info!(
            "♻️ [url_processing] Reusing fetch_result {} for {}",
            fetch_result.id,
            fetch_result.url
        );

        let _ = app.emit(
            "attachment-update",
            serde_json::json!({
                "message_id": user_message_id,
                "conversation_id": conversation_id,
                "attachment_id": fetch_result.id,
                "completed_url": fetch_result.url,
            }),
        );

        attachment_ids.push(fetch_result.id);
        resources.push(resource);
    }

    (resources, attachment_ids)
}

/// Fetch and store URLs, emitting events as each completes.
///
/// `reuse_fetch_result_ids` are existing `fetch_results` rows whose already-
/// stored content should be re-attached to this message without re-fetching.
/// `urls` are brand-new URLs that still need to be fetched.
pub(crate) async fn fetch_and_store_urls(
    state: &AppState,
    app: &tauri::AppHandle,
    urls: &[String],
    reuse_fetch_result_ids: &[String],
    user_message_id: &str,
    conversation_id: &str,
    search_result_id: Option<&str>,
) -> UrlProcessingResult {
    let (mut fetched_resources, mut attachment_ids) = reuse_fetch_results(
        state,
        app,
        reuse_fetch_result_ids,
        user_message_id,
        conversation_id,
    )
    .await;

    if urls.is_empty() {
        if !reuse_fetch_result_ids.is_empty() {
            let _ = app.emit(
                "attachment-processing-complete",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id,
                    "attachment_ids": attachment_ids,
                }),
            );
        }
        return UrlProcessingResult {
            fetched_resources,
            attachment_ids,
        };
    }

    tracing::info!("🔍 [url_processing] Processing {} URLs", urls.len());
    let _ = app.emit(
        "attachment-processing-started",
        serde_json::json!({
            "message_id": user_message_id,
            "conversation_id": conversation_id,
            "urls": urls,
        }),
    );

    // Load fetch config from settings
    let fetch_config = load_fetch_config(state).await;
    tracing::info!(
        "⚙️ [url_processing] Using fetch config: mode={:?}, local_method={:?}",
        fetch_config.mode,
        fetch_config.local_method
    );

    // Process URLs with streaming - results are sent one by one as they complete
    let (mut rx, fetch_handle) = web_fetch::fetch_urls_with_config(urls, None, fetch_config).await;

    // Process each result as it arrives from the channel
    while let Some(resource) = rx.recv().await {
        let content_hash = crate::storage::hash_content(&resource.content);

        // Check if we already have this content (deduplication)
        if let Ok(Some(existing)) = state.db.find_fetch_by_hash(&content_hash).await {
            tracing::info!(
                "♻️ [dedup] Reusing existing fetch content for {} (hash: {}...)",
                resource.url,
                &content_hash[..16]
            );

            // Link existing fetch_result to this message
            if let Err(e) = state
                .db
                .link_message_context(
                    user_message_id,
                    ContextType::FetchResult,
                    &existing.id,
                    None,
                )
                .await
            {
                tracing::error!("Failed to link existing fetch_result to message: {}", e);
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
            tracing::error!(
                "Failed to save content to filesystem for {}: {}",
                resource.url,
                e
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
            (
                "search".to_string(),
                search_result_id.map(|s| s.to_string()),
            )
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
                    tracing::error!("Failed to link fetch_result to message: {}", e);
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
                tracing::error!("Failed to create fetch_result for {}: {}", resource.url, e);
                // Clean up saved file on failure
                let _ = crate::storage::delete_file(app, &storage_path);
            }
        }

        fetched_resources.push(resource);
    }

    // Wait for all fetches to complete
    let _ = fetch_handle.await;

    tracing::info!(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::llm::capabilities::CapabilitiesCache;
    use crate::llm::tools::BashSessionManager;
    use crate::mcp::McpConnectionManager;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    /// AppState backed by a throwaway on-disk SQLite database, mirroring the
    /// setup used across the db test modules. Nothing here touches the
    /// network or the OS keychain stores the app itself would use.
    async fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();

        let state = AppState {
            db,
            generation_tasks: Arc::new(RwLock::new(HashMap::new())),
            mcp_manager: Arc::new(McpConnectionManager::new()),
            pending_oauth: Arc::new(RwLock::new(HashMap::new())),
            bash_session_manager: Arc::new(BashSessionManager::new()),
            capabilities_cache: Arc::new(CapabilitiesCache::new()),
            sync_engine: Arc::new(std::sync::Mutex::new(None)),
        };
        (state, dir)
    }

    #[tokio::test]
    async fn load_fetch_config_defaults_when_settings_absent() {
        let (state, _dir) = test_state().await;

        let config = load_fetch_config(&state).await;

        assert_eq!(config.mode, FetchMode::Local);
        assert_eq!(config.local_method, LocalMethod::Auto);
        assert_eq!(config.jina_api_key, None);
    }

    #[tokio::test]
    async fn load_fetch_config_mode_api_when_setting_is_api() {
        let (state, _dir) = test_state().await;
        state.db.set_setting("web_fetch_mode", "api").await.unwrap();

        let config = load_fetch_config(&state).await;

        assert_eq!(config.mode, FetchMode::Api);
    }

    /// Only the exact string "api" enables API mode; anything else —
    /// including case or whitespace variants — must stay local.
    #[tokio::test]
    async fn load_fetch_config_mode_local_for_unrecognized_values() {
        let (state, _dir) = test_state().await;
        for value in ["local", "", "API", "api ", "cloudflare"] {
            state.db.set_setting("web_fetch_mode", value).await.unwrap();

            let config = load_fetch_config(&state).await;

            assert_eq!(
                config.mode,
                FetchMode::Local,
                "for web_fetch_mode {value:?}"
            );
        }
    }

    #[tokio::test]
    async fn load_fetch_config_local_method_known_values() {
        let (state, _dir) = test_state().await;
        let cases = [
            ("fetch", LocalMethod::FetchOnly),
            ("headless", LocalMethod::ChromeOnly),
            ("obscura", LocalMethod::ObscuraOnly),
            ("webview", LocalMethod::WebViewOnly),
        ];
        for (value, expected) in cases {
            state
                .db
                .set_setting("web_fetch_local_method", value)
                .await
                .unwrap();

            let config = load_fetch_config(&state).await;

            assert_eq!(config.local_method, expected, "for local method {value:?}");
        }
    }

    /// Unknown, empty, or case-mangled methods fall back to Auto. "auto"
    /// itself is not a match arm — it lands in the fallback like the rest.
    #[tokio::test]
    async fn load_fetch_config_local_method_falls_back_to_auto() {
        let (state, _dir) = test_state().await;
        for value in ["auto", "", "chrome", "FETCH"] {
            state
                .db
                .set_setting("web_fetch_local_method", value)
                .await
                .unwrap();

            let config = load_fetch_config(&state).await;

            assert_eq!(
                config.local_method,
                LocalMethod::Auto,
                "for web_fetch_local_method {value:?}"
            );
        }
    }

    /// An empty key is indistinguishable from no key: it must not leak into
    /// the config as a blank credential.
    #[tokio::test]
    async fn load_fetch_config_empty_jina_key_is_dropped() {
        let (state, _dir) = test_state().await;
        state.db.set_setting("jina_api_key", "").await.unwrap();

        let config = load_fetch_config(&state).await;

        assert_eq!(config.jina_api_key, None);
    }

    #[tokio::test]
    async fn load_fetch_config_keeps_non_empty_jina_key() {
        let (state, _dir) = test_state().await;
        state
            .db
            .set_setting("jina_api_key", "jina-secret-123")
            .await
            .unwrap();

        let config = load_fetch_config(&state).await;

        assert_eq!(config.jina_api_key.as_deref(), Some("jina-secret-123"));
    }

    #[tokio::test]
    async fn load_fetch_config_applies_all_settings_together() {
        let (state, _dir) = test_state().await;
        state.db.set_setting("web_fetch_mode", "api").await.unwrap();
        state
            .db
            .set_setting("web_fetch_local_method", "webview")
            .await
            .unwrap();
        state
            .db
            .set_setting("jina_api_key", "jina-key")
            .await
            .unwrap();

        let config = load_fetch_config(&state).await;

        assert_eq!(config.mode, FetchMode::Api);
        assert_eq!(config.local_method, LocalMethod::WebViewOnly);
        assert_eq!(config.jina_api_key.as_deref(), Some("jina-key"));
    }

    /// A broken DB (pool closed) must degrade to safe defaults rather than
    /// erroring out of the fetch pipeline.
    #[tokio::test]
    async fn load_fetch_config_db_error_falls_back_to_defaults() {
        let (state, _dir) = test_state().await;
        state.db.pool().close().await;

        let config = load_fetch_config(&state).await;

        assert_eq!(config.mode, FetchMode::Local);
        assert_eq!(config.local_method, LocalMethod::Auto);
        assert_eq!(config.jina_api_key, None);
    }
}
