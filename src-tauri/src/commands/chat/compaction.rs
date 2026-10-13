//! Context-compaction runner: threshold check after a completed turn,
//! cut-point selection, and the capability-aware method chain — snapcompact
//! for vision models, soft LLM summary as the always-available floor.

use anyhow::Result;
use chatshell_agent_core::compaction::{
    self, HistoryItem, HistoryRole, MAX_SUMMARY_TOKENS, SerializeBudgets,
};
use chatshell_agent_core::context_pruning::estimate_tokens;
use chatshell_agent_core::snapcompact::{self, SnapcompactArchive};

use super::AppState;
use super::aux_models;
use super::title::get_conversation_provider_info;
use crate::db::compactions::CreateCompactionRequest;
use crate::llm::{self, ChatMessage};

/// Fire-and-forget post-turn compaction check (mirrors the title-generation
/// spawn): estimates context usage, and when it crosses the threshold,
/// archives the discardable prefix and records a compaction row.
pub async fn run_post_turn_compaction(state: &AppState, conversation_id: &str) {
    if let Err(error) = run_post_turn_compaction_inner(state, conversation_id).await {
        tracing::warn!("📦 [compaction] skipped for {}: {}", conversation_id, error);
    }
}

async fn run_post_turn_compaction_inner(state: &AppState, conversation_id: &str) -> Result<()> {
    let (provider, model, api_key, base_url, api_style) =
        get_conversation_provider_info(state, conversation_id)
            .await
            .map_err(anyhow::Error::msg)?;

    let capabilities = state.capabilities_cache.resolve(&provider, &model).await;
    let context_window = capabilities
        .max_context_length
        .map(|value| value as usize)
        .unwrap_or(compaction::DEFAULT_CONTEXT_WINDOW);

    let items = load_history_items(state, conversation_id).await?;
    if items.is_empty() {
        return Ok(());
    }

    // Effective context = the prior compaction's real projection cost (frames
    // + text edges for snapcompact, summary for soft) + the still-uncompacted
    // suffix.
    let prior = state.db.latest_active_compaction(conversation_id).await?;
    let region_start = match &prior {
        Some(previous) => items
            .iter()
            .position(|item| item.id == previous.first_kept_message_id)
            .unwrap_or(0),
        None => 0,
    };
    let prior_tokens = prior
        .as_ref()
        .map(|previous| prior_projection_tokens(previous, &provider))
        .unwrap_or(0);
    let context_tokens = prior_tokens + compaction::total_tokens(&items[region_start..]);

    if !compaction::should_compact(context_tokens, context_window) {
        return Ok(());
    }

    let Some(cut) = compaction::find_cut_point(
        &items[region_start..],
        compaction::DEFAULT_KEEP_RECENT_TOKENS,
    ) else {
        tracing::info!(
            "📦 [compaction] no valid cut point for {} (single long turn)",
            conversation_id
        );
        return Ok(());
    };
    let absolute_cut = region_start + cut.keep_from;
    let discarded = &items[region_start..absolute_cut];
    let tokens_before = context_tokens as i64;
    let first_kept_message_id = items[absolute_cut].id.clone();

    // Method chain: snapcompact for vision models, soft summary as the
    // floor. First success wins.
    if capabilities.supports_vision == Some(true) {
        let fresh_transcript = compaction::render_transcript(
            &compaction::build_transcript(discarded, &SerializeBudgets::default()),
            true,
        );
        // The prior compaction's carried source ages in ahead of the newly
        // discarded region: the chain re-renders instead of being shadowed.
        let transcript = merged_transcript_source(prior.as_ref(), &fresh_transcript);
        if let Ok(archive) = snapcompact::build_archive(&transcript, &provider) {
            let summary = format!(
                "Conversation history before this point was archived as {} bitmap frames \
                 (snapcompact): the frames are a verbatim visual archive of the earlier \
                 transcript. Text slices from the archive's chronological edges follow; \
                 {} characters of the middle were dropped by the frame budget.",
                archive.frames.len(),
                archive.chars_dropped
            );
            // Persist the shell only: frames re-render deterministically from
            // source_text + provider when the projection needs them.
            let archive_json = serde_json::to_string(&archive.persisted_shell())?;
            state
                .db
                .create_compaction(CreateCompactionRequest {
                    conversation_id: conversation_id.to_string(),
                    summary,
                    first_kept_message_id,
                    tokens_before,
                    method: "snapcompact".to_string(),
                    archive_json: Some(archive_json),
                })
                .await?;
            tracing::info!(
                "📦 [compaction] snapcompact archived {} items ({} frames) for {}",
                discarded.len(),
                archive.frames.len(),
                conversation_id
            );
            return Ok(());
        }
    }

    // Soft: one-shot LLM summary over the serialized prefix, routed to the
    // lightweight aux model when configured (summary work does not need the
    // conversation's main model).
    let conversation = aux_models::ConversationModel {
        provider_type: provider.clone(),
        model_id: model.clone(),
        api_key: api_key.clone(),
        base_url: base_url.clone(),
        api_style: api_style.clone(),
        supports_vision: capabilities.supports_vision,
    };
    let aux = aux_models::resolve_aux_tiny(state, &conversation).await;

    let transcript = compaction::render_transcript(
        &compaction::build_transcript(discarded, &SerializeBudgets::default()),
        false,
    );
    let user_prompt = compaction::build_summary_user_prompt(
        &transcript,
        prior.as_ref().map(|previous| previous.summary.as_str()),
    );
    let response = llm::call_provider(
        &aux.provider_type,
        aux.model_id,
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: compaction::SUMMARIZATION_SYSTEM_PROMPT.to_string(),
                images: vec![],
                files: vec![],
                tool_calls: vec![],
                tool_call_id: None,
                tool_result_call_id: None,
                reasoning_content: None,
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_prompt,
                images: vec![],
                files: vec![],
                tool_calls: vec![],
                tool_call_id: None,
                tool_result_call_id: None,
                reasoning_content: None,
            },
        ],
        aux.api_key,
        aux.base_url,
        aux.api_style,
    )
    .await?;
    let summary = compaction::clamp_summary(response.content.trim());

    state
        .db
        .create_compaction(CreateCompactionRequest {
            conversation_id: conversation_id.to_string(),
            summary,
            first_kept_message_id,
            tokens_before,
            method: "soft".to_string(),
            archive_json: None,
        })
        .await?;
    tracing::info!(
        "📦 [compaction] soft summary recorded for {} ({} tokens before, ~{} summary tokens)",
        conversation_id,
        tokens_before,
        MAX_SUMMARY_TOKENS
    );
    Ok(())
}

/// Build the chronological history items from stored messages + tool calls.
async fn load_history_items(state: &AppState, conversation_id: &str) -> Result<Vec<HistoryItem>> {
    let messages = state
        .db
        .list_messages_by_conversation(conversation_id)
        .await?;
    let mut items = Vec::with_capacity(messages.len());
    for message in &messages {
        match message.sender_type.as_str() {
            "user" => items.push(HistoryItem {
                id: message.id.clone(),
                role: HistoryRole::User,
                text: message.content.clone(),
                tool_name: None,
            }),
            "model" | "assistant" => {
                let tool_calls = state
                    .db
                    .get_tool_calls_by_message(&message.id)
                    .await
                    .unwrap_or_default();
                for call in &tool_calls {
                    items.push(HistoryItem {
                        id: message.id.clone(),
                        role: HistoryRole::ToolCall,
                        text: call.tool_input.clone().unwrap_or_default(),
                        tool_name: Some(call.tool_name.clone()),
                    });
                    if let Some(output) = &call.tool_output {
                        items.push(HistoryItem {
                            id: message.id.clone(),
                            role: HistoryRole::ToolResult,
                            text: output.clone(),
                            tool_name: Some(call.tool_name.clone()),
                        });
                    }
                }
                if !message.content.trim().is_empty() {
                    items.push(HistoryItem {
                        id: message.id.clone(),
                        role: HistoryRole::Assistant,
                        text: message.content.clone(),
                        tool_name: None,
                    });
                }
            }
            _ => continue,
        }
    }
    Ok(items)
}

/// Deserialize an archive stored on a compaction row (message rebuild).
pub fn parse_archive(json_text: &str) -> Option<SnapcompactArchive> {
    serde_json::from_str(json_text).ok()
}

/// Resolve a compaction row's archive for the projection: legacy rows carry
/// their frames inline; shell rows re-render deterministically from
/// `source_text` + `provider` (frames are a cache, not data). Rendered
/// archives are cached per row for the process lifetime — a few dozen
/// entries at worst, cleared when the cap is hit.
pub fn archive_for_projection(
    row: &crate::db::compactions::Compaction,
) -> Option<SnapcompactArchive> {
    let parsed = parse_archive(row.archive_json.as_deref()?)?;
    if !parsed.frames.is_empty() || parsed.source_text.is_empty() || parsed.provider.is_empty() {
        return Some(parsed);
    }
    static RENDER_CACHE: std::sync::LazyLock<
        std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<SnapcompactArchive>>>,
    > = std::sync::LazyLock::new(|| std::sync::Mutex::new(Default::default()));
    let key = row.id.clone();
    if let Ok(cache) = RENDER_CACHE.lock()
        && let Some(hit) = cache.get(&key)
    {
        return Some((**hit).clone());
    }
    let rendered = snapcompact::build_archive(&parsed.source_text, &parsed.provider).ok()?;
    let rendered = std::sync::Arc::new(rendered);
    if let Ok(mut cache) = RENDER_CACHE.lock() {
        if cache.len() >= 16 {
            cache.clear();
        }
        cache.insert(key, rendered.clone());
    }
    Some((*rendered).clone())
}

/// What the prior compaction row actually costs in the rebuilt projection:
/// snapcompact carries its frames' billed tokens plus the head/tail text
/// edges; soft carries its summary text. The one-line snapcompact summary
/// alone undercounts by the whole frame budget.
fn prior_projection_tokens(prior: &crate::db::compactions::Compaction, provider: &str) -> usize {
    if prior.method == "snapcompact"
        && let Some(archive) = archive_for_projection(prior)
    {
        let family = snapcompact::billing_family(provider);
        return snapcompact::archive_token_estimate(&archive, family)
            + estimate_tokens(&archive.head_text)
            + estimate_tokens(&archive.tail_text);
    }
    estimate_tokens(&prior.summary)
}

/// Source text for a new archive: the prior compaction's carried history
/// (snapcompact source text, or a soft summary) ages in ahead of the newly
/// discarded region, so re-compaction re-renders the whole chain instead of
/// shadowing the earlier archive.
fn merged_transcript_source(
    prior: Option<&crate::db::compactions::Compaction>,
    new_transcript: &str,
) -> String {
    let Some(prior) = prior else {
        return new_transcript.to_string();
    };
    let carried = if prior.method == "snapcompact" {
        prior
            .archive_json
            .as_deref()
            .and_then(parse_archive)
            .map(|archive| archive.source_text)
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| prior.summary.clone())
    } else {
        prior.summary.clone()
    };
    if carried.is_empty() {
        new_transcript.to_string()
    } else {
        format!("{carried}\n\n{new_transcript}")
    }
}
/// The injected summary message for the LLM projection.
pub fn summary_message_text(summary: &str, archive: Option<&SnapcompactArchive>) -> String {
    match archive {
        None => format!(
            "The earlier part of this conversation was compacted. Summary of the previous context:\n\n{summary}"
        ),
        Some(archive) => format!(
            "The earlier part of this conversation was compacted. {summary}\n\n\
             <archive-head>\n{}\n</archive-head>\n\n\
             <archive-tail>\n{}\n</archive-tail>",
            archive.head_text, archive.tail_text
        ),
    }
}

/// Frame images for the summary message (snapcompact archives).
pub fn archive_images(archive: &SnapcompactArchive) -> Vec<crate::llm::ImageData> {
    archive
        .frames
        .iter()
        .map(|frame| crate::llm::ImageData {
            base64: frame.png_base64.clone(),
            media_type: "image/png".to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chatshell_agent_core::snapcompact::build_archive;

    #[test]
    fn parse_archive_round_trips_archive_fields() {
        let transcript: String = (0..24)
            .map(|page| {
                (0..40)
                    .map(|line| format!("page {page} line {line} of archived transcript"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .collect::<Vec<_>>()
            .join("\n");
        let archive = build_archive(&transcript, "custom_anthropic").expect("archive builds");
        let json = serde_json::to_string(&archive).expect("serializes");
        let parsed = parse_archive(&json).expect("parses");
        assert_eq!(parsed.shape, archive.shape);
        assert_eq!(parsed.head_text, archive.head_text);
        assert_eq!(parsed.tail_text, archive.tail_text);
        assert_eq!(parsed.chars_dropped, archive.chars_dropped);
        assert_eq!(parsed.frames.len(), archive.frames.len());
        for (got, want) in parsed.frames.iter().zip(archive.frames.iter()) {
            assert_eq!(got.width, want.width);
            assert_eq!(got.height, want.height);
            assert_eq!(got.png_base64, want.png_base64);
        }
    }

    fn smoke_row(
        method: &str,
        archive_json: Option<String>,
        summary: &str,
    ) -> crate::db::compactions::Compaction {
        crate::db::compactions::Compaction {
            id: format!("row-{method}"),
            conversation_id: "conv".to_string(),
            summary: summary.to_string(),
            first_kept_message_id: "keep".to_string(),
            tokens_before: 90_000,
            method: method.to_string(),
            archive_json,
            created_at: "2026-10-14T00:00:00Z".to_string(),
        }
    }

    fn fixture_transcript(pages: usize) -> String {
        (0..pages)
            .map(|page| {
                (0..40)
                    .map(|line| format!("page {page} line {line} of archived transcript"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn shell_row_re_renders_frames_for_projection() {
        let archive = build_archive(&fixture_transcript(6), "custom_anthropic").unwrap();
        let shell_json = serde_json::to_string(&archive.persisted_shell()).unwrap();
        let row = smoke_row("snapcompact", Some(shell_json), "archived");

        let resolved = archive_for_projection(&row).expect("resolves");
        assert_eq!(resolved.frames.len(), archive.frames.len());
        for (got, want) in resolved.frames.iter().zip(archive.frames.iter()) {
            assert_eq!(got.png_base64, want.png_base64);
        }

        // Legacy rows with inline frames skip the re-render entirely.
        let legacy_json = serde_json::to_string(&archive).unwrap();
        let legacy_row = smoke_row("snapcompact", Some(legacy_json), "archived");
        assert_eq!(
            archive_for_projection(&legacy_row).unwrap().frames.len(),
            archive.frames.len()
        );
    }

    #[test]
    fn prior_projection_tokens_counts_frames_and_edges() {
        let archive = build_archive(&fixture_transcript(6), "custom_anthropic").unwrap();
        let shell_json = serde_json::to_string(&archive.persisted_shell()).unwrap();
        let row = smoke_row("snapcompact", Some(shell_json), "tiny");

        let tokens = prior_projection_tokens(&row, "custom_anthropic");
        let expected = snapcompact::archive_token_estimate(
            &archive,
            snapcompact::billing_family("custom_anthropic"),
        ) + estimate_tokens(&archive.head_text)
            + estimate_tokens(&archive.tail_text);
        assert_eq!(tokens, expected);
        assert!(tokens > estimate_tokens("tiny") * 10);

        // Soft rows still count their summary text.
        let soft = smoke_row("soft", None, "a summary of the migration");
        assert_eq!(
            prior_projection_tokens(&soft, "custom_anthropic"),
            estimate_tokens("a summary of the migration")
        );
    }

    #[test]
    fn merged_transcript_source_chains_the_prior_archive() {
        let prior_archive = build_archive(&fixture_transcript(6), "custom_anthropic").unwrap();
        let shell_json = serde_json::to_string(&prior_archive.persisted_shell()).unwrap();
        let snapcompact_prior = smoke_row("snapcompact", Some(shell_json), "line");

        let merged = merged_transcript_source(Some(&snapcompact_prior), "NEW REGION");
        assert!(merged.starts_with(&prior_archive.source_text));
        assert!(merged.ends_with("NEW REGION"));

        // Soft prior: the summary ages in instead.
        let soft_prior = smoke_row("soft", None, "SOFT SUMMARY");
        let merged = merged_transcript_source(Some(&soft_prior), "NEW REGION");
        assert_eq!(merged, "SOFT SUMMARY\n\nNEW REGION");

        // No prior: passthrough.
        assert_eq!(merged_transcript_source(None, "NEW REGION"), "NEW REGION");
    }
}
