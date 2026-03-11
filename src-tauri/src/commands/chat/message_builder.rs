//! Chat message building for LLM requests
//!
//! Constructs the chat message array including system prompt, history, and current user message.
//! For assistant messages with tool calls, the full tool call chain is reconstructed:
//! assistant(tool_calls) -> tool(result) -> ... -> assistant(final text).

use super::AppState;
use super::attachment_processing;
use crate::llm::{self, ChatMessage, ToolCallData};
use crate::prompts;

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
        reasoning_content: None,
    }];

    if include_history
        && let Ok(messages) = state
            .db
            .list_messages_by_conversation(conversation_id)
            .await
    {
        let history_messages: Vec<_> = messages
            .iter()
            .filter(|msg| msg.id != user_message_id)
            .collect();

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

        for msg in messages_to_include.iter() {
            match msg.sender_type.as_str() {
                "user" => {
                    chat_messages.push(ChatMessage {
                        role: "user".to_string(),
                        content: msg.content.clone(),
                        images: vec![],
                        files: vec![],
                        tool_calls: vec![],
                        tool_call_id: None,
                        reasoning_content: None,
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

                    if db_tool_calls.is_empty() {
                        chat_messages.push(ChatMessage {
                            role: "assistant".to_string(),
                            content: msg.content.clone(),
                            images: vec![],
                            files: vec![],
                            tool_calls: vec![],
                            tool_call_id: None,
                            reasoning_content: reasoning,
                        });
                    } else {
                        let tc_data: Vec<ToolCallData> = db_tool_calls
                            .iter()
                            .map(|tc| ToolCallData {
                                id: tc.id.clone(),
                                tool_name: tc.tool_name.clone(),
                                tool_input: tc.tool_input.clone().unwrap_or_default(),
                                tool_output: tc.tool_output.clone(),
                            })
                            .collect();

                        // 1) Assistant message carrying tool_calls (content may be
                        //    empty when the assistant only invoked tools)
                        let content_blocks = state
                            .db
                            .get_content_blocks_by_message(&msg.id)
                            .await
                            .unwrap_or_default();

                        let pre_tool_text = if !content_blocks.is_empty() {
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
                        } else {
                            String::new()
                        };

                        chat_messages.push(ChatMessage {
                            role: "assistant".to_string(),
                            content: pre_tool_text,
                            images: vec![],
                            files: vec![],
                            tool_calls: tc_data.clone(),
                            tool_call_id: None,
                            reasoning_content: reasoning,
                        });

                        // 2) Tool result messages
                        for tc in &tc_data {
                            if let Some(ref output) = tc.tool_output {
                                chat_messages.push(ChatMessage {
                                    role: "tool".to_string(),
                                    content: output.clone(),
                                    images: vec![],
                                    files: vec![],
                                    tool_calls: vec![],
                                    tool_call_id: Some(tc.id.clone()),
                                    reasoning_content: None,
                                });
                            }
                        }

                        // 3) Final assistant text after tool calls (the stored
                        //    message content), if non-empty
                        if !msg.content.trim().is_empty() {
                            chat_messages.push(ChatMessage {
                                role: "assistant".to_string(),
                                content: msg.content.clone(),
                                images: vec![],
                                files: vec![],
                                tool_calls: vec![],
                                tool_call_id: None,
                                reasoning_content: None,
                            });
                        }
                    }
                }
                _ => continue,
            }
        }
    }

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
        reasoning_content: None,
    });

    chat_messages
}
