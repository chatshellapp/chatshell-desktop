//! Context-compaction runner (Wave 2b follow-up): threshold check after a
//! completed turn, cut-point selection, and the capability-aware method
//! chain — snapcompact for vision models, soft LLM summary as the
//! always-available floor. Design: internal-docs/features/compaction-v1.md.

use anyhow::Result;
use chatshell_agent_core::compaction::{
    self, HistoryItem, HistoryRole, MAX_SUMMARY_TOKENS, SerializeBudgets,
};
use chatshell_agent_core::context_pruning::estimate_tokens;
use chatshell_agent_core::snapcompact::{self, SnapcompactArchive};

use super::AppState;
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

    // Effective context = prior compaction summary (if any) + the
    // still-uncompacted suffix.
    let prior = state.db.latest_active_compaction(conversation_id).await?;
    let region_start = match &prior {
        Some(previous) => items
            .iter()
            .position(|item| item.id == previous.first_kept_message_id)
            .unwrap_or(0),
        None => 0,
    };
    let prior_summary_tokens = prior
        .as_ref()
        .map(|previous| estimate_tokens(&previous.summary))
        .unwrap_or(0);
    let context_tokens = prior_summary_tokens + compaction::total_tokens(&items[region_start..]);

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
        let transcript = compaction::render_transcript(
            &compaction::build_transcript(discarded, &SerializeBudgets::default()),
            true,
        );
        if let Ok(archive) = snapcompact::build_archive(&transcript, &provider) {
            let summary = format!(
                "Conversation history before this point was archived as {} bitmap frames \
                 (snapcompact): the frames are a verbatim visual archive of the earlier \
                 transcript. Text slices from the archive's chronological edges follow; \
                 {} characters of the middle were dropped by the frame budget.",
                archive.frames.len(),
                archive.chars_dropped
            );
            let archive_json = serde_json::to_string(&archive)?;
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

    // Soft: one-shot LLM summary over the serialized prefix.
    let transcript = compaction::render_transcript(
        &compaction::build_transcript(discarded, &SerializeBudgets::default()),
        false,
    );
    let user_prompt = compaction::build_summary_user_prompt(
        &transcript,
        prior.as_ref().map(|previous| previous.summary.as_str()),
    );
    let response = llm::call_provider(
        &provider,
        model,
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
        api_key,
        base_url,
        api_style,
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
