//! Chat message building for LLM requests
//!
//! Constructs the chat message array including system prompt, history, and current user message.

use super::AppState;
use super::attachment_processing;
use crate::llm::{self, ChatMessage};
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
    // Build system prompt
    let system_prompt_content = system_prompt
        .clone()
        .unwrap_or_else(|| prompts::DEFAULT_ASSISTANT_SYSTEM_PROMPT.to_string());

    let mut chat_messages = vec![ChatMessage {
        role: "system".to_string(),
        content: system_prompt_content,
        images: vec![],
        files: vec![],
    }];

    // Include message history if requested
    if include_history {
        if let Ok(messages) = state
            .db
            .list_messages_by_conversation(conversation_id)
            .await
        {
            // Filter out the current user message first
            let history_messages: Vec<_> = messages
                .iter()
                .filter(|msg| msg.id != user_message_id)
                .collect();

            // Apply context message count limit if specified
            let messages_to_include = match context_message_count {
                Some(count) if count > 0 => {
                    let count = count as usize;
                    if history_messages.len() > count {
                        // Take only the last N messages
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
                _ => &history_messages[..], // None or negative: include all
            };

            for msg in messages_to_include.iter() {
                let chat_role = match msg.sender_type.as_str() {
                    "user" => "user",
                    "model" | "assistant" => "assistant",
                    _ => continue,
                };
                chat_messages.push(ChatMessage {
                    role: chat_role.to_string(),
                    content: msg.content.clone(),
                    images: vec![],
                    files: vec![],
                });
            }
        }
    }

    // Add current user message with processed content
    let final_user_content = if let Some(prompt) = user_prompt {
        format!("{}\n\n{}", prompt, processed_content)
    } else {
        processed_content.to_string()
    };

    // Extract ImageData for LLM
    let llm_images: Vec<llm::ImageData> = user_images.iter().map(|img| img.data.clone()).collect();

    chat_messages.push(ChatMessage {
        role: "user".to_string(),
        content: final_user_content,
        images: llm_images,
        files: user_files.to_vec(),
    });

    chat_messages
}
