//! Search decision and execution logic

use super::super::AppState;
use crate::models::{CreateSearchDecisionRequest, CreateSearchResultRequest};
use crate::web_search::SearchProvider;
use tauri::Emitter;

/// Result of search processing
pub(crate) struct SearchProcessingResult {
    pub urls: Vec<String>,
    pub search_result_id: Option<String>,
}

/// Get the configured search provider from settings
async fn get_search_provider(state: &AppState) -> SearchProvider {
    match state.db.get_setting("search_provider").await {
        Ok(Some(provider_id)) => SearchProvider::from_id(&provider_id).unwrap_or_default(),
        _ => SearchProvider::default(),
    }
}

/// Process search decision and execute search if needed
pub(crate) async fn process_search_decision(
    state: &AppState,
    app: &tauri::AppHandle,
    content: &str,
    provider: &str,
    model: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    user_message_id: &str,
    conversation_id: &str,
    fallback_urls: Vec<String>,
) -> SearchProcessingResult {
    tracing::info!("🔍 [search] Web search enabled, checking if search is needed...");

    // Emit event to show "deciding" state immediately
    let _ = app.emit(
        "search-decision-started",
        serde_json::json!({
            "message_id": user_message_id,
            "conversation_id": conversation_id,
        }),
    );

    // Use AI to decide if search is truly needed
    let decision =
        match crate::web_search::decide_search_needed(content, provider, model, api_key, base_url)
            .await
        {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("⚠️ [search] Search decision failed, skipping search: {}", e);
                crate::web_search::SearchDecisionResult {
                    reasoning: format!("Decision failed: {}", e),
                    search_needed: false,
                    search_query: None,
                }
            }
        };

    // Store the search decision in database (as a process step)
    match state
        .db
        .create_search_decision(CreateSearchDecisionRequest {
            message_id: user_message_id.to_string(),
            reasoning: decision.reasoning.clone(),
            search_needed: decision.search_needed,
            search_query: decision.search_query.clone(),
            search_result_id: None,
            display_order: Some(0),
        })
        .await
    {
        Ok(search_decision) => {
            tracing::info!(
                "📝 [search] Created search decision: {}",
                search_decision.id
            );
            // SearchDecision is now directly linked via message_id FK

            // Emit search decision complete for UI
            let _ = app.emit(
                "search-decision-complete",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id,
                }),
            );
        }
        Err(e) => {
            tracing::error!("❌ [search] Failed to create search decision: {}", e);
        }
    }

    if !decision.search_needed {
        tracing::info!(
            "ℹ️ [search] AI decided search is NOT needed: {}",
            decision.reasoning
        );
        return SearchProcessingResult {
            urls: fallback_urls,
            search_result_id: None,
        };
    }

    // Use AI-generated search query (better optimized than raw user input)
    let keywords = decision
        .search_query
        .unwrap_or_else(|| crate::web_search::extract_search_keywords(content));
    tracing::info!(
        "🔍 [search] AI decided search is needed, query: {}",
        keywords
    );

    // Get the configured search provider
    let provider = get_search_provider(state).await;
    let engine_id = provider.id().to_string();
    tracing::info!(
        "🔍 [search] Using search provider: {}",
        provider.display_name()
    );

    // Create SearchResult IMMEDIATELY (before searching) so UI can show it
    let searched_at = chrono::Utc::now().to_rfc3339();
    let search_result_id = match state
        .db
        .create_search_result(CreateSearchResultRequest {
            message_id: user_message_id.to_string(),
            query: keywords.clone(),
            engine: engine_id.clone(),
            total_results: None,
            display_order: Some(0),
            searched_at: searched_at.clone(),
        })
        .await
    {
        Ok(search_result) => {
            tracing::info!(
                "📝 [search] Created pending search result: {}",
                search_result.id
            );
            // SearchResult is now directly linked via message_id FK

            // Emit attachment update so UI shows SearchPreview immediately
            let _ = app.emit(
                "attachment-update",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id,
                    "attachment": {
                        "type": "search_result",
                        "id": search_result.id,
                        "query": keywords,
                        "engine": engine_id,
                        "total_results": null,
                        "searched_at": searched_at,
                    }
                }),
            );

            Some(search_result.id)
        }
        Err(e) => {
            tracing::error!("Failed to create search result: {}", e);
            None
        }
    };

    // Now perform the actual search using the configured provider
    match crate::web_search::search(provider, &keywords, 5).await {
        Ok(search_response) => {
            tracing::info!(
                "✅ [search] Search completed, found {} results",
                search_response.results.len()
            );

            // Update SearchResult with actual results count
            if let Some(ref sr_id) = search_result_id {
                if let Err(e) = state
                    .db
                    .update_search_result_total(sr_id, search_response.total_results as i64)
                    .await
                {
                    tracing::error!("Failed to update search result total: {}", e);
                }

                // Emit attachment-update so frontend shows result count immediately
                let _ = app.emit(
                    "attachment-update",
                    serde_json::json!({
                        "message_id": user_message_id,
                        "conversation_id": conversation_id,
                        "attachment": {
                            "type": "search_result",
                            "id": sr_id,
                            "query": search_response.query,
                            "engine": search_response.provider.id(),
                            "total_results": search_response.total_results,
                        }
                    }),
                );
            }

            // Emit search completed event
            let search_urls: Vec<String> = search_response
                .results
                .iter()
                .map(|r| r.url.clone())
                .collect();
            let _ = app.emit(
                "search-completed",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id,
                    "search_result_id": search_result_id,
                    "query": search_response.query,
                    "results_count": search_response.results.len(),
                }),
            );

            SearchProcessingResult {
                urls: search_urls,
                search_result_id,
            }
        }
        Err(e) => {
            tracing::error!("❌ [search] Search failed: {}", e);
            SearchProcessingResult {
                urls: fallback_urls,
                search_result_id,
            }
        }
    }
}
