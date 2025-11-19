use anyhow::Result;
use futures::StreamExt;
use rig::completion::{CompletionModel, CompletionRequest, Message};
use rig::message::{AssistantContent, UserContent};
use rig::streaming::StreamedAssistantContent;
use rig::OneOrMany;
use tokio_util::sync::CancellationToken;

use crate::llm::{ChatRequest, ChatResponse};
use crate::thinking_parser;

/// Common streaming handler for all LLM providers
/// This eliminates code duplication across openai, openrouter, and ollama
pub async fn chat_stream_common<M: CompletionModel>(
    model: M,
    request: ChatRequest,
    cancel_token: CancellationToken,
    mut callback: impl FnMut(String) -> bool + Send,
    log_prefix: &str,
) -> Result<ChatResponse> {
    println!("🤖 [{}] Model created: {}", log_prefix, request.model);
    
    // Convert messages to rig's Message format
    let mut chat_history = Vec::new();
    
    for (i, msg) in request.messages.iter().enumerate() {
        if i < request.messages.len() - 1 {
            // Earlier messages are history
            let rig_msg = match msg.role.as_str() {
                "user" => Message::User {
                    content: OneOrMany::one(UserContent::Text(msg.content.clone().into())),
                },
                "assistant" => Message::Assistant {
                    id: None,
                    content: OneOrMany::one(AssistantContent::Text(msg.content.clone().into())),
                },
                _ => Message::User {
                    content: OneOrMany::one(UserContent::Text(msg.content.clone().into())),
                },
            };
            chat_history.push(rig_msg);
        }
    }
    
    // Last message is the current prompt
    let prompt_msg = request.messages.last().unwrap();
    let prompt = Message::User {
        content: OneOrMany::one(UserContent::Text(prompt_msg.content.clone().into())),
    };
    
    println!("📝 [{}] Prompt: {} chars, history: {} messages", 
             log_prefix,
             prompt_msg.content.len(), 
             chat_history.len());
    
    // Build completion request
    let completion_request = CompletionRequest {
        preamble: None,
        chat_history: {
            let mut all_messages = chat_history;
            all_messages.push(prompt);
            OneOrMany::many(all_messages).unwrap()
        },
        documents: vec![],
        tools: vec![],
        temperature: None,
        max_tokens: None,
        tool_choice: None,
        additional_params: None,
    };
    
    println!("📤 [{}] Starting streaming request...", log_prefix);
    
    // Create stream
    let mut stream = model.stream(completion_request).await?;
    
    let mut full_content = String::new();
    let mut cancelled = false;
    
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
            Ok(StreamedAssistantContent::Text(text)) => {
                let text_str = &text.text;
                if !text_str.is_empty() {
                    full_content.push_str(text_str);
                    
                    // Call callback and check if it signals cancellation
                    if !callback(text_str.to_string()) {
                        println!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(_) => {
                // Ignore tool calls, reasoning, and final responses
            }
            Err(e) => {
                eprintln!("❌ [{}] Stream error: {}", log_prefix, e);
                return Err(e.into());
            }
        }
    }
    
    if cancelled {
        println!("⚠️ [{}] Stream was cancelled", log_prefix);
    } else {
        println!("✅ [{}] Stream completed successfully", log_prefix);
    }
    
    // Parse thinking content
    let parsed = thinking_parser::parse_thinking_content(&full_content);
    
    println!("📊 [{}] Parsed content: {} chars, thinking: {}", 
             log_prefix,
             parsed.content.len(), 
             parsed.thinking_content.is_some());
    
    Ok(ChatResponse {
        content: parsed.content,
        thinking_content: parsed.thinking_content,
        tokens: None,
    })
}


