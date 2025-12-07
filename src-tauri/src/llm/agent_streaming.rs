//! Agent streaming module for handling streaming chat responses.
//!
//! This module provides the streaming implementation for all agent types,
//! handling cancellation, error recovery, and thinking content parsing.

use anyhow::Result;
use futures::StreamExt;
use rig::agent::{Agent, MultiTurnStreamItem};
use rig::completion::{CompletionModel, Message};
use rig::message::Reasoning;
use rig::streaming::{StreamedAssistantContent, StreamingChat};
use tokio_util::sync::CancellationToken;

use crate::llm::common::StreamChunkType;
use crate::llm::ChatResponse;
use crate::thinking_parser;

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
    println!("🤖 [{}] Agent created, starting stream chat", log_prefix);

    // Use stream_chat to get a streaming response with chat history
    // stream_chat returns a StreamingPromptRequest which implements IntoFuture
    // When awaited, it returns the stream directly (not wrapped in Result)
    let mut stream = agent.stream_chat(prompt, chat_history).await;

    let mut full_content = String::new();
    let mut full_reasoning = String::new();
    let mut cancelled = false;
    let mut consecutive_errors = 0;
    let mut is_reasoning = false;
    const MAX_CONSECUTIVE_ERRORS: u32 = 3;

    println!("📥 [{}] Processing stream...", log_prefix);

    // Process stream with cancellation support
    while let Some(result) = stream.next().await {
        if cancel_token.is_cancelled() {
            println!("🛑 [{}] Cancellation detected, stopping stream", log_prefix);
            cancelled = true;
            drop(stream);
            break;
        }

        match result {
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(text))) => {
                consecutive_errors = 0;
                // Detect transition from reasoning to text
                if is_reasoning {
                    is_reasoning = false;
                    println!("💡 [{}] Reasoning ended", log_prefix);
                }
                let text_str = &text.text;
                if !text_str.is_empty() {
                    full_content.push_str(text_str);

                    if !callback(text_str.to_string(), StreamChunkType::Text) {
                        println!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Reasoning(
                Reasoning { reasoning, .. },
            ))) => {
                consecutive_errors = 0;
                // Detect reasoning start
                if !is_reasoning {
                    is_reasoning = true;
                    println!("💡 [{}] Reasoning started", log_prefix);
                }
                let reasoning_text = reasoning.join("");
                if !reasoning_text.is_empty() {
                    full_reasoning.push_str(&reasoning_text);

                    if !callback(reasoning_text, StreamChunkType::Reasoning) {
                        println!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(_) => {
                consecutive_errors = 0;
                // Ignore tool calls, final responses, and user items for now
            }
            Err(e) => {
                consecutive_errors += 1;
                let error_str = e.to_string();

                let is_decode_error = error_str.contains("decoding response body")
                    || error_str.contains("error reading a body")
                    || error_str.contains("connection")
                    || error_str.contains("stream");

                if is_decode_error && !full_content.is_empty() {
                    eprintln!(
                        "⚠️ [{}] Stream decode error after receiving content, treating as stream end: {}",
                        log_prefix, error_str
                    );
                    break;
                }

                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    eprintln!(
                        "❌ [{}] Too many consecutive stream errors ({}): {}",
                        log_prefix, consecutive_errors, error_str
                    );
                    if !full_content.is_empty() {
                        eprintln!(
                            "⚠️ [{}] Returning partial content ({} chars) due to stream errors",
                            log_prefix,
                            full_content.len()
                        );
                        break;
                    }
                    return Err(anyhow::anyhow!("Stream error: {}", error_str));
                }

                eprintln!(
                    "⚠️ [{}] Stream error ({}/{}), continuing: {}",
                    log_prefix, consecutive_errors, MAX_CONSECUTIVE_ERRORS, error_str
                );
            }
        }
    }

    // Handle case where reasoning was active when stream ended
    if is_reasoning {
        println!("💡 [{}] Reasoning ended", log_prefix);
    }

    if cancelled {
        println!("⚠️ [{}] Stream was cancelled", log_prefix);
    } else {
        println!("✅ [{}] Stream completed successfully", log_prefix);
    }

    // Parse thinking content from XML tags in the text
    let parsed = thinking_parser::parse_thinking_content(&full_content);

    // Combine API-provided reasoning with XML-parsed thinking content
    let final_thinking = if !full_reasoning.is_empty() {
        Some(full_reasoning.trim().to_string())
    } else {
        parsed.thinking_content
    };

    println!(
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

