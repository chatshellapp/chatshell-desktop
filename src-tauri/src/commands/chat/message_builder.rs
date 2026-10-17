//! Chat message building for LLM requests
//!
//! Constructs the chat message array including system prompt, history, and current user message.
//! For assistant messages with tool calls, the full tool call chain is reconstructed:
//! assistant(tool_calls) -> tool(result) -> ... -> assistant(final text).

use super::AppState;
use super::attachment_processing::{self, StoredFile};
use crate::llm::{self, ChatMessage, ToolCallData};
use crate::models::UserAttachment;
use crate::prompts;
use chatshell_agent_core::context_pruning::{self as pruning, PrunePolicy, ToolOutputRef};
use chatshell_agent_core::history::{HistoryRole, HistoryRow, ToolCallRow, pair_history};
use chatshell_agent_core::types::MessageRole as CoreMessageRole;
use std::collections::HashMap;

/// The compaction-boundary message injected ahead of the kept history:
/// summary text, and for snapcompact rows the archive's head/tail text
/// slices plus its frame images (re-rendered from the persisted shell for
/// rows that no longer carry frames inline).
fn compaction_boundary_message(row: &crate::db::compactions::Compaction) -> ChatMessage {
    let archive = super::compaction::archive_for_projection(row);
    ChatMessage {
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
    }
}

/// Per-attachment inline budget. Attachments above this are represented by a
/// path manifest and fetched with the read tool when the model needs them.
const INLINE_ATTACHMENT_TOKENS: usize = 8_000;
/// Total per-message inline budget across all file attachments.
const INLINE_ATTACHMENT_TOTAL_TOKENS: usize = 16_000;
/// Characters of a lazily-projected attachment shown as a relevance preview.
const ATTACHMENT_PREVIEW_CHARS: usize = 500;
/// Newest historical user messages that keep an attachment manifest.
const HISTORY_MANIFEST_MESSAGES: usize = 20;
/// Attachments listed per historical message.
const HISTORY_MANIFEST_ATTACHMENTS: usize = 8;

/// One attachment listed in the on-disk manifest sent to the model.
struct ManifestAttachment {
    name: String,
    mime_type: String,
    size: usize,
    path: String,
    preview: Option<String>,
}

fn xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render_attachment_manifest(entries: &[ManifestAttachment]) -> String {
    if entries.is_empty() {
        return String::new();
    }

    let mut out = String::from(
        "<attachments note=\"Attachments are stored on disk. Use the read tool with a path to inspect them (offset/limit for text; question for images).\">\n",
    );
    for entry in entries {
        out.push_str(&format!(
            "<attachment name=\"{}\" mime=\"{}\" size=\"{}\" path=\"{}\"",
            xml_attr(&entry.name),
            xml_attr(&entry.mime_type),
            entry.size,
            xml_attr(&entry.path),
        ));
        if let Some(preview) = &entry.preview {
            out.push_str(&format!(" preview=\"{}\"", xml_attr(preview)));
        }
        out.push_str(" />\n");
    }
    out.push_str("</attachments>");
    out
}

/// Budget estimate for attachment text. CJK characters are roughly one
/// token each; other text is ~4 chars/token. The shared pruning estimator
/// assumes 4 chars/token throughout, which under-counts CJK-heavy PDFs by
/// roughly 4x.
fn estimate_attachment_tokens(text: &str) -> usize {
    let mut cjk = 0usize;
    let mut other = 0usize;
    for ch in text.chars() {
        if matches!(
            ch,
            '\u{4E00}'..='\u{9FFF}'
                | '\u{3400}'..='\u{4DBF}'
                | '\u{F900}'..='\u{FAFF}'
                | '\u{3040}'..='\u{30FF}'
                | '\u{AC00}'..='\u{D7AF}'
        ) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    cjk + other.div_ceil(4)
}

/// One flag per file: `true` = project as a lazy manifest, `false` = inline.
fn attachment_manifest_plan(files: &[llm::FileData], read_available: bool) -> Vec<bool> {
    if !read_available {
        return vec![false; files.len()];
    }

    let mut plan = Vec::with_capacity(files.len());
    let mut inline_tokens = 0usize;
    for file in files {
        let tokens = estimate_attachment_tokens(&file.content);
        let over_budget = tokens > INLINE_ATTACHMENT_TOKENS
            || inline_tokens.saturating_add(tokens) > INLINE_ATTACHMENT_TOTAL_TOKENS;
        plan.push(over_budget);
        if !over_budget {
            inline_tokens = inline_tokens.saturating_add(tokens);
        }
    }
    plan
}

/// Split the current turn's files into inline content and lazy manifests.
/// Inlining falls back on the original behavior when the read tool is not
/// available, or when a large file could not be persisted.
fn project_file_attachments(
    resolve_path: &dyn Fn(&str) -> Option<std::path::PathBuf>,
    files: &[llm::FileData],
    stored_files: &[Option<StoredFile>],
    read_available: bool,
) -> (Vec<llm::FileData>, Vec<ManifestAttachment>) {
    let plan = attachment_manifest_plan(files, read_available);
    let mut inline = Vec::new();
    let mut manifest = Vec::new();

    for (index, file) in files.iter().enumerate() {
        let stored_path = stored_files
            .get(index)
            .and_then(|stored| stored.as_ref())
            .and_then(|stored| resolve_path(&stored.storage_path));

        if plan[index]
            && let Some(path) = stored_path
        {
            manifest.push(ManifestAttachment {
                name: file.name.clone(),
                mime_type: file.media_type.clone(),
                size: file.content.len(),
                path: path.to_string_lossy().into_owned(),
                preview: Some(pruning::ellipsize(&file.content, ATTACHMENT_PREVIEW_CHARS)),
            });
            continue;
        }

        inline.push(file.clone());
    }

    (inline, manifest)
}

/// Historical turns never re-inline attachment content. List the persisted
/// files instead so a follow-up question can fetch them with the read tool.
fn history_attachment_manifest(
    resolve_path: &dyn Fn(&str) -> Option<std::path::PathBuf>,
    attachments: &[UserAttachment],
) -> Option<String> {
    let entries: Vec<ManifestAttachment> = attachments
        .iter()
        .take(HISTORY_MANIFEST_ATTACHMENTS)
        .filter_map(|attachment| match attachment {
            UserAttachment::File(file) => {
                let path = resolve_path(&file.storage_path)?;
                Some(ManifestAttachment {
                    name: file.file_name.clone(),
                    mime_type: file.mime_type.clone(),
                    size: file.file_size.max(0) as usize,
                    path: path.to_string_lossy().into_owned(),
                    preview: None,
                })
            }
        })
        .collect();

    if entries.is_empty() {
        None
    } else {
        Some(render_attachment_manifest(&entries))
    }
}

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
    stored_files: &[Option<StoredFile>],
    app: &tauri::AppHandle,
    read_available: bool,
    context_message_count: Option<i64>,
) -> Vec<ChatMessage> {
    let resolve_attachment_path =
        |storage_path: &str| crate::storage::get_full_path(app, storage_path).ok();

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
            .list_messages_by_conversation(conversation_id, None, None)
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
            chat_messages.push(compaction_boundary_message(row));
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

        // Attachment manifests for historical turns. One query for the whole
        // included window; the current turn is projected separately below.
        let user_message_ids: Vec<String> = messages_to_include
            .iter()
            .filter(|msg| msg.sender_type == "user")
            .map(|msg| msg.id.clone())
            .collect();
        let attachments_by_message = if read_available {
            state
                .db
                .get_message_attachments_batch(&user_message_ids)
                .await
                .unwrap_or_default()
        } else {
            HashMap::new()
        };
        // Keep manifests bounded in long conversations: newest first.
        let manifest_message_ids: std::collections::HashSet<&str> = messages_to_include
            .iter()
            .rev()
            .filter(|msg| msg.sender_type == "user" && attachments_by_message.contains_key(&msg.id))
            .take(HISTORY_MANIFEST_MESSAGES)
            .map(|msg| msg.id.as_str())
            .collect();

        // Flatten DB rows and expand tool-call turns through the shared core
        // protocol (assistant+tool_calls -> tool results -> final text).
        let mut history_rows: Vec<HistoryRow> = Vec::with_capacity(messages_to_include.len());
        // Tool-call id -> (name, output), for projection fields and pruning.
        let mut tool_index: HashMap<String, (String, Option<String>)> = HashMap::new();
        for msg in messages_to_include.iter() {
            match msg.sender_type.as_str() {
                "user" => {
                    let mut content = msg.content.clone();
                    if read_available
                        && manifest_message_ids.contains(msg.id.as_str())
                        && let Some(attachments) = attachments_by_message.get(&msg.id)
                        && let Some(manifest) =
                            history_attachment_manifest(&resolve_attachment_path, attachments)
                    {
                        content.push_str("\n\n");
                        content.push_str(&manifest);
                    }
                    history_rows.push(HistoryRow {
                        role: HistoryRole::User,
                        content,
                        pre_tool_content: String::new(),
                        reasoning_content: None,
                        tool_calls: Vec::new(),
                        images: Vec::new(),
                    });
                }
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

    let (llm_files, manifest_entries) = project_file_attachments(
        &resolve_attachment_path,
        user_files,
        stored_files,
        read_available,
    );
    let mut final_user_content = if let Some(prompt) = user_prompt {
        format!("{}\n\n{}", prompt, processed_content)
    } else {
        processed_content.to_string()
    };
    let manifest = render_attachment_manifest(&manifest_entries);
    if !manifest.is_empty() {
        final_user_content.push_str("\n\n");
        final_user_content.push_str(&manifest);
    }

    let llm_images: Vec<llm::ImageData> = user_images.iter().map(|img| img.data.clone()).collect();

    chat_messages.push(ChatMessage {
        role: "user".to_string(),
        content: final_user_content,
        images: llm_images,
        files: llm_files,
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

    fn compaction_row(
        method: &str,
        archive_json: Option<String>,
    ) -> crate::db::compactions::Compaction {
        crate::db::compactions::Compaction {
            id: "compaction-1".to_string(),
            conversation_id: "conv-1".to_string(),
            summary: "Conversation history before this point was archived as 3 bitmap frames \
                      (snapcompact)."
                .to_string(),
            first_kept_message_id: "msg-keep".to_string(),
            tokens_before: 90_000,
            method: method.to_string(),
            archive_json,
            created_at: "2026-10-13T00:00:00Z".to_string(),
        }
    }

    fn fixture_transcript_text() -> String {
        (0..24)
            .map(|page| {
                (0..40)
                    .map(|line| format!("page {page} line {line} of archived transcript"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn fixture_archive_json() -> String {
        let archive = chatshell_agent_core::snapcompact::build_archive(
            &fixture_transcript_text(),
            "custom_openai",
        )
        .expect("archive builds");
        serde_json::to_string(&archive).expect("archive serializes")
    }

    #[test]
    fn snapcompact_row_injects_archive_edges_and_frames() {
        let row = compaction_row("snapcompact", Some(fixture_archive_json()));
        let message = compaction_boundary_message(&row);
        assert_eq!(message.role, "user");
        assert!(message.content.contains("archived as"), "summary lead-in");
        assert!(message.content.contains("<archive-head>"));
        assert!(message.content.contains("<archive-tail>"));
        assert!(message.tool_calls.is_empty());

        let archive = super::super::compaction::parse_archive(row.archive_json.as_deref().unwrap())
            .expect("archive parses");
        assert_eq!(message.images.len(), archive.frames.len());
        for (image, frame) in message.images.iter().zip(archive.frames.iter()) {
            assert_eq!(image.media_type, "image/png");
            assert_eq!(image.base64, frame.png_base64);
        }
    }

    #[test]
    fn shell_row_re_renders_frames_for_injection() {
        // New rows persist only the shell (no base64 frames); the boundary
        // message must still carry the re-rendered frame images.
        let full = chatshell_agent_core::snapcompact::build_archive(
            &fixture_transcript_text(),
            "custom_openai",
        )
        .expect("archive builds");
        let shell_json = serde_json::to_string(&full.persisted_shell()).unwrap();
        let row = compaction_row("snapcompact", Some(shell_json));

        let message = compaction_boundary_message(&row);
        assert!(message.content.contains("<archive-head>"));
        assert_eq!(message.images.len(), full.frames.len());
        for (image, frame) in message.images.iter().zip(full.frames.iter()) {
            assert_eq!(image.base64, frame.png_base64);
            assert_eq!(image.media_type, "image/png");
        }
    }

    #[test]
    fn soft_row_and_malformed_archive_fall_back_to_text_only() {
        let soft = compaction_boundary_message(&compaction_row("soft", None));
        assert!(soft.images.is_empty());
        assert!(soft.content.contains("Summary of the previous context:"));
        assert!(!soft.content.contains("<archive-head>"));

        let malformed = compaction_boundary_message(&compaction_row(
            "snapcompact",
            Some("{not json".to_string()),
        ));
        assert!(malformed.images.is_empty());
        assert!(!malformed.content.contains("<archive-head>"));
    }

    fn file_data(name: &str, chars: usize) -> llm::FileData {
        llm::FileData {
            name: name.to_string(),
            content: "x".repeat(chars),
            media_type: "text/plain".to_string(),
        }
    }

    #[test]
    fn small_attachments_inline_and_large_ones_manifest() {
        let files = vec![
            file_data("small.txt", 400),
            file_data("large.txt", INLINE_ATTACHMENT_TOKENS * 4 + 4),
        ];

        let plan = attachment_manifest_plan(&files, true);
        assert_eq!(plan, vec![false, true]);
    }

    #[test]
    fn cjk_attachment_uses_conservative_token_estimate() {
        let files = vec![llm::FileData {
            name: "cjk.txt".to_string(),
            content: format!(
                "{}{}{}",
                "汉".repeat(3_000),
                "あ".repeat(3_000),
                "한".repeat(3_000),
            ),
            media_type: "text/plain".to_string(),
        }];

        let plan = attachment_manifest_plan(&files, true);
        assert_eq!(plan, vec![true]);
    }

    #[test]
    fn read_unavailable_inlines_large_attachments() {
        let files = vec![file_data("large.txt", INLINE_ATTACHMENT_TOKENS * 8)];

        let plan = attachment_manifest_plan(&files, false);
        assert_eq!(plan, vec![false]);
    }

    #[test]
    fn total_inline_budget_moves_later_attachments_to_manifest() {
        // 4k tokens each: the first four fit the 16k total, the fifth does not.
        let files: Vec<_> = (0..5)
            .map(|i| file_data(&format!("part-{i}.txt"), 16_000))
            .collect();

        let plan = attachment_manifest_plan(&files, true);
        assert_eq!(plan, vec![false, false, false, false, true]);
    }

    #[test]
    fn manifest_escapes_xml_attributes() {
        let entries = vec![ManifestAttachment {
            name: "a&b\"<c>.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            size: 10,
            path: "/tmp/a&b\".txt".to_string(),
            preview: Some("x < y & z".to_string()),
        }];

        let manifest = render_attachment_manifest(&entries);
        assert!(
            manifest.contains("a&amp;b&quot;&lt;c&gt;.pdf"),
            "{manifest}"
        );
        assert!(manifest.contains("/tmp/a&amp;b&quot;.txt"), "{manifest}");
        assert!(manifest.contains("x &lt; y &amp; z"), "{manifest}");
        assert!(manifest.contains("size=\"10\""), "{manifest}");
    }

    #[test]
    fn empty_manifest_is_empty() {
        assert!(render_attachment_manifest(&[]).is_empty());
    }

    #[test]
    fn projection_inlines_small_and_manifests_large_with_path() {
        let dir = tempfile::tempdir().unwrap();
        let resolver = |storage_path: &str| Some(dir.path().join(storage_path));
        let files = vec![
            file_data("small.txt", 400),
            file_data("large.txt", INLINE_ATTACHMENT_TOKENS * 4 + 4),
        ];
        let stored_files = vec![
            Some(StoredFile {
                storage_path: "small.txt".to_string(),
            }),
            Some(StoredFile {
                storage_path: "large.txt".to_string(),
            }),
        ];

        let (inline, manifest) = project_file_attachments(&resolver, &files, &stored_files, true);

        assert_eq!(inline.len(), 1);
        assert_eq!(inline[0].name, "small.txt");
        assert_eq!(manifest.len(), 1);
        assert_eq!(manifest[0].name, "large.txt");
        assert!(
            manifest[0].path.ends_with("large.txt"),
            "{:?}",
            manifest[0].path
        );
        assert!(
            manifest[0]
                .preview
                .as_deref()
                .is_some_and(|preview| !preview.is_empty())
        );
    }

    #[test]
    fn history_manifest_lists_paths_without_preview() {
        let dir = tempfile::tempdir().unwrap();
        let resolver = |storage_path: &str| Some(dir.path().join(storage_path));
        let attachments = vec![UserAttachment::File(crate::models::FileAttachment {
            id: "f1".to_string(),
            file_name: "report.pdf".to_string(),
            file_size: 123,
            mime_type: "application/pdf".to_string(),
            storage_path: "files/hash.txt".to_string(),
            content_hash: "hash".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        })];
        let expected_path = dir
            .path()
            .join("files/hash.txt")
            .to_string_lossy()
            .into_owned();

        let manifest = history_attachment_manifest(&resolver, &attachments).expect("manifest");

        assert!(manifest.contains("name=\"report.pdf\""), "{manifest}");
        assert!(manifest.contains(&expected_path), "{manifest}");
        assert!(!manifest.contains("preview="), "{manifest}");
    }
}
