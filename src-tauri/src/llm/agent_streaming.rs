//! Agent streaming module for handling streaming chat responses.
//!
//! This module provides the streaming implementation for all agent types,
//! handling cancellation, error recovery, and thinking content parsing.

use anyhow::Result;
use futures::StreamExt;
use rig::agent::{Agent, MultiTurnStreamItem};
use rig::completion::{CompletionModel, Message};
use rig::message::Reasoning;
use rig::streaming::{StreamedAssistantContent, StreamedUserContent, StreamingChat};
use tokio_util::sync::CancellationToken;

use crate::llm::ChatResponse;
use crate::llm::common::{StreamChunkType, ToolCallInfo, ToolResultInfo};
use crate::thinking_parser;

/// Strip internal error prefixes (e.g. "CompletionError: ProviderError: ") to
/// produce a cleaner user-facing message.
fn strip_internal_prefixes(error: &str) -> String {
    let mut s = error;
    for prefix in &[
        "CompletionError: ProviderError: ",
        "Provider error: ",
        "ProviderError: ",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest;
        }
    }
    s.to_string()
}

/// Generic implementation for streaming with any agent type
pub async fn stream_agent<M>(
    agent: Agent<M>,
    prompt: Message,
    chat_history: Vec<Message>,
    cancel_token: CancellationToken,
    mut callback: impl FnMut(String, StreamChunkType) -> bool + Send,
    log_prefix: &str,
) -> Result<ChatResponse>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: rig::completion::GetTokenUsage,
{
    tracing::info!("🤖 [{}] Agent created, starting stream chat", log_prefix);

    let mut stream = agent
        .stream_chat(prompt, chat_history)
        .multi_turn(100)
        .await;

    let mut full_content = String::new();
    let mut full_reasoning = String::new();
    let mut cancelled = false;
    let mut consecutive_errors = 0;
    let mut is_reasoning = false;
    let mut last_error: Option<String> = None;
    const MAX_CONSECUTIVE_ERRORS: u32 = 3;

    tracing::info!("📥 [{}] Processing stream...", log_prefix);

    // Process stream with cancellation support.
    // Use tokio::select! so cancellation takes effect immediately,
    // even while a tool call is executing inside stream.next().
    loop {
        let result = tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                tracing::info!("🛑 [{}] Cancellation detected, stopping stream", log_prefix);
                cancelled = true;
                drop(stream);
                break;
            }
            item = stream.next() => {
                match item {
                    Some(r) => r,
                    None => break,
                }
            }
        };

        match result {
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(text))) => {
                consecutive_errors = 0;
                // Detect transition from reasoning to text
                if is_reasoning {
                    is_reasoning = false;
                    tracing::info!("💡 [{}] Reasoning ended", log_prefix);
                }
                let text_str = &text.text;
                if !text_str.is_empty() {
                    full_content.push_str(text_str);

                    if !callback(text_str.to_string(), StreamChunkType::Text) {
                        tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Reasoning(
                Reasoning { content, .. },
            ))) => {
                consecutive_errors = 0;
                if !is_reasoning {
                    is_reasoning = true;
                    tracing::info!("💡 [{}] Reasoning started", log_prefix);
                }
                let reasoning_text: String = content
                    .iter()
                    .filter_map(|rc| match rc {
                        rig::message::ReasoningContent::Text { text, .. } => Some(text.as_str()),
                        rig::message::ReasoningContent::Summary(s) => Some(s.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("");
                if !reasoning_text.is_empty() {
                    full_reasoning.push_str(&reasoning_text);

                    if !callback(reasoning_text, StreamChunkType::Reasoning) {
                        tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::ToolCall {
                tool_call,
                ..
            })) => {
                consecutive_errors = 0;
                let tool_input = serde_json::to_string(&tool_call.function.arguments)
                    .unwrap_or_else(|_| "{}".to_string());

                tracing::info!(
                    "🔧 [{}] Tool call: {} (id: {})",
                    log_prefix,
                    tool_call.function.name,
                    tool_call.id
                );

                let tool_info = ToolCallInfo {
                    id: tool_call.id.clone(),
                    tool_name: tool_call.function.name.clone(),
                    tool_input,
                };

                if !callback(String::new(), StreamChunkType::ToolCall(tool_info)) {
                    tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                    cancelled = true;
                    break;
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Image(
                data_url,
            ))) => {
                consecutive_errors = 0;
                tracing::info!(
                    "🖼️ [{}] Image received ({} bytes)",
                    log_prefix,
                    data_url.len()
                );
                if !callback(data_url.clone(), StreamChunkType::Image(data_url)) {
                    tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                    cancelled = true;
                    break;
                }
            }
            Ok(MultiTurnStreamItem::StreamUserItem(StreamedUserContent::ToolResult {
                tool_result,
                ..
            })) => {
                consecutive_errors = 0;
                let tool_output = tool_result
                    .content
                    .iter()
                    .filter_map(|c| match c {
                        rig::message::ToolResultContent::Text(text) => Some(text.text.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

                tracing::info!(
                    "📦 [{}] Tool result received (id: {}, {} chars)",
                    log_prefix,
                    tool_result.id,
                    tool_output.len()
                );

                let result_info = ToolResultInfo {
                    id: tool_result.id.clone(),
                    tool_output,
                };

                if !callback(String::new(), StreamChunkType::ToolResult(result_info)) {
                    tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                    cancelled = true;
                    break;
                }
            }
            Ok(MultiTurnStreamItem::FinalResponse(final_response)) => {
                consecutive_errors = 0;
                // Log final response usage if available
                let usage = final_response.usage();
                if usage.input_tokens > 0 || usage.output_tokens > 0 {
                    tracing::info!(
                        "📊 [{}] Usage: {} input, {} output tokens",
                        log_prefix,
                        usage.input_tokens,
                        usage.output_tokens
                    );
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(
                StreamedAssistantContent::ReasoningDelta { reasoning, .. },
            )) => {
                consecutive_errors = 0;
                if !is_reasoning {
                    is_reasoning = true;
                    tracing::info!("💡 [{}] Reasoning started", log_prefix);
                }
                if !reasoning.is_empty() {
                    full_reasoning.push_str(&reasoning);

                    if !callback(reasoning, StreamChunkType::Reasoning) {
                        tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(_) => {
                consecutive_errors = 0;
            }
            Err(e) => {
                consecutive_errors += 1;
                let error_str = e.to_string();
                last_error = Some(strip_internal_prefixes(&error_str));

                let is_decode_error = error_str.contains("decoding response body")
                    || error_str.contains("error reading a body")
                    || error_str.contains("connection")
                    || error_str.contains("stream");

                if is_decode_error && !full_content.is_empty() {
                    tracing::error!(
                        "⚠️ [{}] Stream decode error after receiving content, treating as stream end: {}",
                        log_prefix,
                        error_str
                    );
                    break;
                }

                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    tracing::error!(
                        "❌ [{}] Too many consecutive stream errors ({}): {}",
                        log_prefix,
                        consecutive_errors,
                        error_str
                    );
                    if !full_content.is_empty() {
                        tracing::error!(
                            "⚠️ [{}] Returning partial content ({} chars) due to stream errors",
                            log_prefix,
                            full_content.len()
                        );
                        break;
                    }
                    return Err(anyhow::anyhow!("{}", strip_internal_prefixes(&error_str)));
                }

                tracing::error!(
                    "⚠️ [{}] Stream error ({}/{}), continuing: {}",
                    log_prefix,
                    consecutive_errors,
                    MAX_CONSECUTIVE_ERRORS,
                    error_str
                );
            }
        }
    }

    // Handle case where reasoning was active when stream ended
    if is_reasoning {
        tracing::info!("💡 [{}] Reasoning ended", log_prefix);
    }

    if cancelled {
        tracing::warn!("⚠️ [{}] Stream was cancelled", log_prefix);
    } else {
        tracing::info!("✅ [{}] Stream completed successfully", log_prefix);
    }

    // If stream ended with no content and there were errors, return the error
    if full_content.is_empty()
        && !cancelled
        && let Some(err) = last_error
    {
        let clean_err = strip_internal_prefixes(&err);
        tracing::error!(
            "❌ [{}] Stream ended with no content after error(s), propagating: {}",
            log_prefix,
            clean_err
        );
        return Err(anyhow::anyhow!("{}", clean_err));
    }

    // Parse thinking content from XML tags in the text
    let parsed = thinking_parser::parse_thinking_content(&full_content);

    // Combine API-provided reasoning with XML-parsed thinking content
    let final_thinking = if !full_reasoning.is_empty() {
        Some(full_reasoning.trim().to_string())
    } else {
        parsed.thinking_content
    };

    tracing::info!(
        "📊 [{}] Parsed content: {} chars, API reasoning: {} chars, final thinking: {}",
        log_prefix,
        parsed.content.len(),
        full_reasoning.len(),
        final_thinking.is_some()
    );

    Ok(ChatResponse {
        content: parsed.content,
        thinking_content: final_thinking,
        tokens: None,
    })
}
