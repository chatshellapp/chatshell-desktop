//! Search decision and execution logic
//!
//! Two paths, chosen by capability:
//!
//! - The model can fetch pages itself (web_search/web_fetch enabled): one
//!   search runs with the user's own query, only the result page is handed
//!   over, and the model reads whichever URLs it needs. No decision
//!   completion, no body prefetch.
//! - The model cannot fetch pages: a lightweight model decides whether a
//!   search is warranted, and page bodies are fetched and inlined because
//!   the model has no way to retrieve them later.

use super::super::AppState;
use super::aux_models::{ConversationModel, resolve_aux_tiny};
use crate::models::{CreateSearchDecisionRequest, CreateSearchResultRequest, SearchResultItem};
use crate::web_search::SearchProvider;
use tauri::Emitter;

/// Result entries handed to the model and persisted for the UI.
const MAX_SERP_ITEMS: usize = 6;
/// Snippet budget per entry; enough to rank relevance, not to read the page.
const MAX_SNIPPET_CHARS: usize = 300;

/// Result of search processing
pub(crate) struct SearchProcessingResult {
    /// Result-page URLs the caller should fetch and inline. Empty when the
    /// model can fetch pages itself: the URLs already reach it as text.
    pub urls: Vec<String>,
    pub search_result_id: Option<String>,
    /// Compact SERP block appended to the current user turn.
    pub serp_context: Option<String>,
}

/// Process search decision and execute search if needed
#[allow(clippy::too_many_arguments)]
pub(crate) async fn process_search_decision(
    state: &AppState,
    app: &tauri::AppHandle,
    content: &str,
    provider: &str,
    model: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    api_style: Option<&str>,
    user_message_id: &str,
    conversation_id: &str,
    model_can_fetch: bool,
) -> SearchProcessingResult {
    tracing::info!(
        "🔍 [search] Web search enabled (model_can_fetch={})",
        model_can_fetch
    );

    let decision = if model_can_fetch {
        // The user asked for a search; the model owns relevance and reading.
        // Run the search directly instead of paying for a decision
        // completion whose conclusion the model can reach by calling the
        // tool itself.
        crate::web_search::SearchDecisionResult {
            reasoning: "Web tools are available; searching with the user's query and \
                        letting the model read only the pages it needs."
                .to_string(),
            search_needed: true,
            search_query: Some(crate::web_search::extract_search_keywords(content)),
        }
    } else {
        // Emit event to show "deciding" state immediately
        let _ = app.emit(
            "search-decision-started",
            serde_json::json!({
                "message_id": user_message_id,
                "conversation_id": conversation_id,
            }),
        );

        let conversation = ConversationModel {
            provider_type: provider.to_string(),
            model_id: model.to_string(),
            api_key: api_key.map(str::to_string),
            base_url: base_url.map(str::to_string),
            api_style: api_style.map(str::to_string),
            supports_vision: None,
        };
        let aux = resolve_aux_tiny(state, &conversation).await;

        match crate::web_search::decide_search_needed(
            content,
            &aux.provider_type,
            &aux.model_id,
            aux.api_key.as_deref(),
            aux.base_url.as_deref(),
            aux.api_style.as_deref(),
        )
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
            urls: Vec::new(),
            search_result_id: None,
            serp_context: None,
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
    let preferred = state.db.get_search_provider().await;
    let engine_id = preferred.id().to_string();
    tracing::info!(
        "🔍 [search] Using search provider: {}",
        preferred.display_name()
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

    // Search, falling back across engines when one is blocked or empty.
    match crate::web_search::search_with_fallback(preferred, &keywords, 5).await {
        Ok(result) => {
            let response = &result.response;
            tracing::info!(
                "✅ [search] Search completed via {}, found {} results",
                response.provider.display_name(),
                response.results.len()
            );

            let items: Vec<SearchResultItem> = response
                .results
                .iter()
                .map(|r| SearchResultItem {
                    title: r.title.clone(),
                    url: r.url.clone(),
                    snippet: r.snippet.clone(),
                })
                .collect();

            if let Some(sr_id) = &search_result_id {
                // Items and count land in one write: the UI's retry loop
                // keys off total_results, so both must be visible together.
                if let Err(e) = state.db.update_search_result_items(sr_id, &items).await {
                    tracing::error!("Failed to persist search result items: {}", e);
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
                            "query": response.query,
                            "engine": response.provider.id(),
                            "total_results": items.len(),
                        }
                    }),
                );
            }

            // Emit search completed event
            let _ = app.emit(
                "search-completed",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id,
                    "search_result_id": search_result_id,
                    "query": response.query,
                    "results_count": items.len(),
                }),
            );

            let serp_context = render_serp_context(
                &response.query,
                response.provider.display_name(),
                &items,
                &result.failures,
            );

            SearchProcessingResult {
                // Only inline bodies when the model has no way to read URLs
                // on demand. With web tools, the SERP block is the handoff;
                // without them, the bodies already carry the same URLs, so
                // the block would be duplicate context.
                urls: if model_can_fetch {
                    Vec::new()
                } else {
                    items.iter().map(|item| item.url.clone()).collect()
                },
                search_result_id,
                serp_context: model_can_fetch.then_some(serp_context),
            }
        }
        Err(e) => {
            tracing::error!("❌ [search] Search failed on every provider: {}", e);

            if let Some(sr_id) = &search_result_id {
                let _ = state.db.update_search_result_total(sr_id, 0).await;
            }
            let _ = app.emit(
                "search-completed",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id,
                    "search_result_id": search_result_id,
                    "query": keywords,
                    "results_count": 0,
                    "error": e.to_string(),
                }),
            );

            SearchProcessingResult {
                urls: Vec::new(),
                search_result_id,
                serp_context: None,
            }
        }
    }
}

/// Render the compact block the model receives instead of page bodies.
/// Kept deterministic and bounded so the prompt cost of a search stays flat
/// regardless of snippet length or result count.
pub(crate) fn render_serp_context(
    query: &str,
    engine: &str,
    items: &[SearchResultItem],
    failures: &[(SearchProvider, String)],
) -> String {
    let mut out = String::from("## Web search results\n\n");
    out.push_str(&format!(
        "Query: \"{}\" — {} ({} results)\n\n",
        query,
        engine,
        items.len()
    ));

    if !failures.is_empty() {
        let attempted: Vec<String> = failures
            .iter()
            .map(|(provider, reason)| format!("{} ({})", provider.display_name(), reason))
            .collect();
        out.push_str(&format!(
            "Note: earlier attempts returned nothing: {}.\nResults below came from {}.\n\n",
            attempted.join(", "),
            engine
        ));
    }

    for (index, item) in items.iter().take(MAX_SERP_ITEMS).enumerate() {
        out.push_str(&format!(
            "{}. {}\n   URL: {}\n   {}\n\n",
            index + 1,
            item.title.trim(),
            item.url,
            truncate_chars(item.snippet.trim(), MAX_SNIPPET_CHARS)
        ));
    }

    out.push_str(
        "Read only the pages you need. The full body is not included; \
         use web_fetch on a URL above when its snippet is not enough.\n",
    );
    out
}

fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let truncated: String = text.chars().take(limit).collect();
    format!("{truncated}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(index: usize) -> SearchResultItem {
        SearchResultItem {
            title: format!("Result {index}"),
            url: format!("https://example.com/{index}"),
            snippet: "snippet text".to_string(),
        }
    }

    #[test]
    fn serp_context_lists_results_and_points_at_web_fetch() {
        let items = vec![item(0), item(1)];
        let rendered = render_serp_context("rust async", "DuckDuckGo", &items, &[]);

        assert!(rendered.contains("Query: \"rust async\" — DuckDuckGo (2 results)"));
        assert!(rendered.contains("1. Result 0"));
        assert!(rendered.contains("URL: https://example.com/1"));
        assert!(rendered.contains("use web_fetch"));
        assert!(!rendered.contains("earlier attempts"));
    }

    #[test]
    fn serp_context_caps_items_and_snippets() {
        let long = SearchResultItem {
            title: "Long".to_string(),
            url: "https://example.com/long".to_string(),
            snippet: "x".repeat(MAX_SNIPPET_CHARS * 2),
        };
        let mut all = vec![long];
        all.extend((0..MAX_SERP_ITEMS + 4).map(item));

        let rendered = render_serp_context("q", "Yahoo", &all, &[]);
        assert!(rendered.contains("1. Long"));
        assert!(rendered.contains('…'));
        assert!(rendered.contains(&format!("{MAX_SERP_ITEMS}. Result {}", MAX_SERP_ITEMS - 2)));
        assert!(!rendered.contains(&format!("{}. ", MAX_SERP_ITEMS + 1)));
    }

    #[test]
    fn serp_context_reports_fallback_attempts() {
        let rendered = render_serp_context(
            "q",
            "Yahoo",
            &[item(0)],
            &[(SearchProvider::DuckDuckGo, "no results".to_string())],
        );
        assert!(rendered.contains("DuckDuckGo (no results)"));
        assert!(rendered.contains("Results below came from Yahoo."));
    }
}
