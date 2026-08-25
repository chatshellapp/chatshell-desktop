//! Chat message building for LLM requests
//!
//! Constructs the chat message array including system prompt, history, and current user message.
//! For assistant messages with tool calls, the full tool call chain is reconstructed:
//! assistant(tool_calls) -> tool(result) -> ... -> assistant(final text).

use super::AppState;
use super::attachment_processing;
use crate::llm::{self, ChatMessage, ToolCallData};
use crate::prompts;
use chatshell_agent_core::context_pruning::{self as pruning, PrunePolicy, ToolOutputRef};
use chatshell_agent_core::history::{HistoryRole, HistoryRow, ToolCallRow, pair_history};
use chatshell_agent_core::types::MessageRole as CoreMessageRole;
use std::collections::HashMap;

/// Build chat messages for LLM request
///
/// # Arguments
/// * `context_message_count` - Optional limit on number of history messages to include.
///   - `None` or negative value: include all history
///   - `Some(n)` where n > 0: include only the last n messages
#[allow(clippy::too_many_arguments)]
pub async fn build_chat_messages(
    state: &AppState,
    conversation_id: &str,
    user_message_id: &str,
    processed_content: &str,
    user_prompt: &Option<String>,
    system_prompt: &Option<String>,
    include_history: bool,
    user_images: &[attachment_processing::ParsedImage],
    user_files: &[llm::FileData],
    context_message_count: Option<i64>,
) -> Vec<ChatMessage> {
    let base_prompt = system_prompt
        .clone()
        .unwrap_or_else(|| prompts::DEFAULT_ASSISTANT_SYSTEM_PROMPT.to_string());

    let system_prompt_content = base_prompt;

    let mut chat_messages = vec![ChatMessage {
        role: "system".to_string(),
        content: system_prompt_content,
        images: vec![],
        files: vec![],
        tool_calls: vec![],
        tool_call_id: None,
        tool_result_call_id: None,
        reasoning_content: None,
    }];

    // Tool outputs seen while building, in chronological order; pruned
    // in one pass after the loop so the policy sees the whole history.
    let mut tool_output_records: Vec<ToolOutputRecord> = Vec::new();

    if include_history
        && let Ok(messages) = state
            .db
            .list_messages_by_conversation(conversation_id)
            .await
    {
        let mut history_messages: Vec<_> = messages
            .iter()
            .filter(|msg| msg.id != user_message_id)
            .collect();

        // Compaction boundary: the LLM projection replaces everything before
        // the latest compaction's first_kept_message_id with its summary
        // message (display history stays complete — only the projection
        // shrinks, same discipline as tool-output pruning below).
        let compaction_row = state
            .db
            .latest_active_compaction(conversation_id)
            .await
            .ok()
            .flatten();
        let compaction_start = compaction_row.as_ref().and_then(|row| {
            history_messages
                .iter()
                .position(|msg| msg.id == row.first_kept_message_id)
        });
        if let (Some(row), Some(start)) = (&compaction_row, compaction_start)
            && start > 0
        {
            let archive = row
                .archive_json
                .as_deref()
                .and_then(super::compaction::parse_archive);
            chat_messages.push(ChatMessage {
                role: "user".to_string(),
                content: super::compaction::summary_message_text(&row.summary, archive.as_ref()),
                images: archive
                    .as_ref()
                    .map(super::compaction::archive_images)
                    .unwrap_or_default(),
                files: vec![],
                tool_calls: vec![],
                tool_call_id: None,
                tool_result_call_id: None,
                reasoning_content: None,
            });
            history_messages = history_messages.split_off(start);
        }

        let messages_to_include = match context_message_count {
            Some(count) if count > 0 => {
                let count = count as usize;
                if history_messages.len() > count {
                    tracing::info!(
                        "📊 [message_builder] Limiting context to {} messages (had {})",
                        count,
                        history_messages.len()
                    );
                    &history_messages[history_messages.len() - count..]
                } else {
                    &history_messages[..]
                }
            }
            _ => &history_messages[..],
        };

        // Flatten DB rows and expand tool-call turns through the shared core
        // protocol (assistant+tool_calls -> tool results -> final text).
        let mut history_rows: Vec<HistoryRow> = Vec::with_capacity(messages_to_include.len());
        // Tool-call id -> (name, output), for projection fields and pruning.
        let mut tool_index: HashMap<String, (String, Option<String>)> = HashMap::new();
        for msg in messages_to_include.iter() {
            match msg.sender_type.as_str() {
                "user" => history_rows.push(HistoryRow {
                    role: HistoryRole::User,
                    content: msg.content.clone(),
                    pre_tool_content: String::new(),
                    reasoning_content: None,
                    tool_calls: Vec::new(),
                    images: Vec::new(),
                }),
                "model" | "assistant" => {
                    let db_tool_calls = state
                        .db
                        .get_tool_calls_by_message(&msg.id)
                        .await
                        .unwrap_or_default();

                    let thinking_steps = state
                        .db
                        .get_thinking_steps_by_message(&msg.id)
                        .await
                        .unwrap_or_default();
                    let reasoning = if thinking_steps.is_empty() {
                        None
                    } else {
                        let joined: String = thinking_steps
                            .iter()
                            .map(|s| s.content.as_str())
                            .collect::<Vec<_>>()
                            .join("\n");
                        if joined.trim().is_empty() {
                            None
                        } else {
                            Some(joined)
                        }
                    };

                    let tool_calls: Vec<ToolCallRow> = db_tool_calls
                        .iter()
                        .map(|tc| {
                            tool_index.insert(
                                tc.id.clone(),
                                (tc.tool_name.clone(), tc.tool_output.clone()),
                            );
                            ToolCallRow {
                                id: tc.id.clone(),
                                call_id: tc.call_id.clone(),
                                name: tc.tool_name.clone(),
                                arguments_json: tc.tool_input.clone().unwrap_or_default(),
                                output: tc.tool_output.clone(),
                            }
                        })
                        .collect();

                    // Assistant text emitted before the first tool call,
                    // recovered from ordered content blocks.
                    let pre_tool_content = if tool_calls.is_empty() {
                        String::new()
                    } else {
                        let content_blocks = state
                            .db
                            .get_content_blocks_by_message(&msg.id)
                            .await
                            .unwrap_or_default();
                        if content_blocks.is_empty() {
                            String::new()
                        } else {
                            let min_tc_order = db_tool_calls
                                .iter()
                                .map(|tc| tc.display_order)
                                .min()
                                .unwrap_or(0);
                            content_blocks
                                .iter()
                                .filter(|cb| cb.display_order < min_tc_order)
                                .map(|cb| cb.content.as_str())
                                .collect::<Vec<_>>()
                                .join("")
                        }
                    };

                    history_rows.push(HistoryRow {
                        role: HistoryRole::Assistant,
                        content: msg.content.clone(),
                        pre_tool_content,
                        reasoning_content: reasoning,
                        tool_calls,
                        images: Vec::new(),
                    });
                }
                _ => continue,
            }
        }

        for message in pair_history(&history_rows) {
            if message.role == CoreMessageRole::Tool {
                let tool_name = message
                    .tool_call_id
                    .as_deref()
                    .and_then(|id| tool_index.get(id))
                    .map(|(name, _)| name.clone())
                    .unwrap_or_default();
                tool_output_records.push(ToolOutputRecord {
                    chat_index: chat_messages.len(),
                    tokens: pruning::estimate_tokens(&message.content),
                    uneventful: pruning::is_uneventful(&tool_name, &message.content),
                    tool_name,
                });
                chat_messages.push(ChatMessage {
                    role: "tool".to_string(),
                    content: message.content,
                    images: vec![],
                    files: vec![],
                    tool_calls: vec![],
                    tool_call_id: message.tool_call_id,
                    tool_result_call_id: message.tool_result_call_id,
                    reasoning_content: None,
                });
            } else {
                chat_messages.push(ChatMessage {
                    role: match message.role {
                        CoreMessageRole::System => "system",
                        CoreMessageRole::User => "user",
                        _ => "assistant",
                    }
                    .to_string(),
                    content: message.content,
                    images: vec![],
                    files: vec![],
                    tool_calls: message
                        .tool_calls
                        .into_iter()
                        .map(|tc| ToolCallData {
                            tool_output: tool_index
                                .get(&tc.id)
                                .and_then(|(_, output)| output.clone()),
                            id: tc.id,
                            call_id: tc.call_id,
                            tool_name: tc.name,
                            tool_input: tc.arguments_json,
                        })
                        .collect(),
                    tool_call_id: None,
                    tool_result_call_id: None,
                    reasoning_content: message.reasoning_content,
                });
            }
        }
    }

    // Collapse old, individually-large tool outputs into truncation notices.
    // Protected window and threshold rules live in chatshell-agent-core.
    apply_tool_output_pruning(&mut chat_messages, &tool_output_records);

    let final_user_content = if let Some(prompt) = user_prompt {
        format!("{}\n\n{}", prompt, processed_content)
    } else {
        processed_content.to_string()
    };

    let llm_images: Vec<llm::ImageData> = user_images.iter().map(|img| img.data.clone()).collect();

    chat_messages.push(ChatMessage {
        role: "user".to_string(),
        content: final_user_content,
        images: llm_images,
        files: user_files.to_vec(),
        tool_calls: vec![],
        tool_call_id: None,
        tool_result_call_id: None,
        reasoning_content: None,
    });

    chat_messages
}

/// One built tool-result message: where it landed and how large it is.
struct ToolOutputRecord {
    chat_index: usize,
    tool_name: String,
    tokens: usize,
    uneventful: bool,
}

/// Apply the shared pruning policy to built tool-result messages. Entries on
/// the older side of the protected window collapse into a short notice; the
/// plan is all-keep unless the total saving clears the threshold.
fn apply_tool_output_pruning(chat_messages: &mut [ChatMessage], records: &[ToolOutputRecord]) {
    if records.is_empty() {
        return;
    }
    let entries: Vec<ToolOutputRef> = records
        .iter()
        .map(|r| ToolOutputRef {
            tool_name: r.tool_name.clone(),
            tokens: r.tokens,
            uneventful: r.uneventful,
        })
        .collect();
    let plan = pruning::plan_prune(&entries, &PrunePolicy::default());
    let elide = pruning::plan_elide_uneventful(&entries, pruning::DEFAULT_KEEP_RECENT_UNEVENTFUL);
    for ((record, truncate), elide) in records.iter().zip(plan).zip(elide) {
        if truncate {
            chat_messages[record.chat_index].content = pruning::truncation_notice(record.tokens);
        } else if elide {
            chat_messages[record.chat_index].content = pruning::UNEVENTFUL_NOTICE.to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_msg(id: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: "tool".to_string(),
            content: content.to_string(),
            images: vec![],
            files: vec![],
            tool_calls: vec![],
            tool_call_id: Some(id.to_string()),
            tool_result_call_id: None,
            reasoning_content: None,
        }
    }

    #[test]
    fn old_large_outputs_collapse_into_notices() {
        // 10 old 4000-char bash outputs (~1000 tokens each) plus one recent
        // huge output filling the protected window.
        let mut messages: Vec<ChatMessage> = Vec::new();
        let mut records = Vec::new();
        // ~3k tokens each: ten of them clear the default 20k savings floor.
        for i in 0..10 {
            records.push(ToolOutputRecord {
                chat_index: messages.len(),
                tool_name: "bash".to_string(),
                tokens: 3_000,
                uneventful: false,
            });
            messages.push(tool_msg(&format!("old-{i}"), &"x".repeat(12_000)));
        }
        records.push(ToolOutputRecord {
            chat_index: messages.len(),
            tool_name: "bash".to_string(),
            tokens: 60_000,
            uneventful: false,
        });
        messages.push(tool_msg("recent", &"y".repeat(240_000)));

        apply_tool_output_pruning(&mut messages, &records);

        for (i, msg) in messages.iter().take(10).enumerate() {
            assert_eq!(msg.content, "[Output truncated - ~3000 tokens]", "msg {i}");
        }
        assert_eq!(
            messages[10].content,
            "y".repeat(240_000),
            "recent stays verbatim"
        );
    }

    #[test]
    fn below_savings_threshold_keeps_everything() {
        let mut messages: Vec<ChatMessage> = Vec::new();
        let mut records = Vec::new();
        for i in 0..3 {
            records.push(ToolOutputRecord {
                chat_index: messages.len(),
                tool_name: "bash".to_string(),
                tokens: 1_000,
                uneventful: false,
            });
            messages.push(tool_msg(&format!("old-{i}"), &"x".repeat(4_000)));
        }
        // Default min_total_savings is 20k; ~3k savings -> no-op.
        apply_tool_output_pruning(&mut messages, &records);
        assert!(
            messages.iter().all(|m| m.content.starts_with('x')),
            "nothing pruned"
        );
    }

    #[test]
    fn stale_uneventful_outputs_elide() {
        let mut messages: Vec<ChatMessage> = Vec::new();
        let mut records = Vec::new();
        // 10 old zero-hit searches (small, below prune floor) + 1 recent.
        for i in 0..10 {
            records.push(ToolOutputRecord {
                chat_index: messages.len(),
                tool_name: "web_search".to_string(),
                tokens: 30,
                uneventful: true,
            });
            messages.push(tool_msg(&format!("hit-{i}"), "No results found."));
        }
        records.push(ToolOutputRecord {
            chat_index: messages.len(),
            tool_name: "web_search".to_string(),
            tokens: 30,
            uneventful: true,
        });
        messages.push(tool_msg("recent", "No results found."));

        apply_tool_output_pruning(&mut messages, &records);

        // 11 entries, keep 8 newest -> cutoff 3: the 3 oldest elide.
        for (i, msg) in messages.iter().take(3).enumerate() {
            assert_eq!(msg.content, "[Uneventful result elided]", "msg {i}");
        }
        for (i, msg) in messages.iter().skip(3).enumerate() {
            assert_eq!(msg.content, "No results found.", "kept {i}");
        }
    }

    #[test]
    fn skill_outputs_survive() {
        let mut messages: Vec<ChatMessage> = Vec::new();
        let mut records = Vec::new();
        records.push(ToolOutputRecord {
            chat_index: messages.len(),
            tool_name: "skill".to_string(),
            tokens: 30_000,
            uneventful: false,
        });
        messages.push(tool_msg("skill", &"s".repeat(120_000)));
        records.push(ToolOutputRecord {
            chat_index: messages.len(),
            tool_name: "bash".to_string(),
            tokens: 60_000,
            uneventful: false,
        });
        messages.push(tool_msg("recent", &"y".repeat(240_000)));

        apply_tool_output_pruning(&mut messages, &records);
        assert!(messages[0].content.starts_with('s'), "skill output kept");
    }
}
