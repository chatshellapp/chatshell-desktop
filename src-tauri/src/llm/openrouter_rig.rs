use anyhow::Result;
use futures::StreamExt;
use rig::completion::Chat;
use rig::providers::openai;
use tokio_util::sync::CancellationToken;

use crate::llm::{ChatMessage, ChatRequest, ChatResponse};
use crate::thinking_parser;

pub struct OpenRouterRigProvider {
    api_key: String,
}

impl OpenRouterRigProvider {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }

    pub async fn chat_stream(
        &self,
        request: ChatRequest,
        cancel_token: CancellationToken,
        mut callback: impl FnMut(String) -> bool + Send,
    ) -> Result<ChatResponse> {
        println!("🌐 [openrouter_rig] Creating client with custom base URL");
        
        // Create OpenAI-compatible client with OpenRouter base URL
        let client = openai::Client::new(&self.api_key)
            .with_base_url("https://openrouter.ai/api/v1");
        
        // Build agent with model
        let agent = client.agent(&request.model).build();
        
        println!("🤖 [openrouter_rig] Agent created for model: {}", request.model);
        
        // Convert messages to rig's Chat format
        let mut chat = Chat::default();
        
        for (i, msg) in request.messages.iter().enumerate() {
            if i == request.messages.len() - 1 {
                // Last message is the current prompt
                println!("📝 [openrouter_rig] Setting prompt: {} chars", msg.content.len());
                chat = chat.prompt(&msg.content);
            } else {
                // Earlier messages are history
                match msg.role.as_str() {
                    "user" => {
                        chat = chat.history(rig::completion::Message {
                            role: "user".to_string(),
                            content: msg.content.clone(),
                        });
                    }
                    "assistant" => {
                        chat = chat.history(rig::completion::Message {
                            role: "assistant".to_string(),
                            content: msg.content.clone(),
                        });
                    }
                    _ => {
                        // Other roles treated as user
                        chat = chat.history(rig::completion::Message {
                            role: "user".to_string(),
                            content: msg.content.clone(),
                        });
                    }
                }
            }
        }
        
        println!("📤 [openrouter_rig] Starting streaming request...");
        
        // Create stream
        let mut stream = chat.stream(&agent).await?;
        
        let mut full_content = String::new();
        let mut cancelled = false;
        
        println!("📥 [openrouter_rig] Processing stream...");
        
        // Process stream with cancellation support
        while let Some(result) = stream.next().await {
            if cancel_token.is_cancelled() {
                println!("🛑 [openrouter_rig] Cancellation detected, stopping stream");
                cancelled = true;
                drop(stream);
                break;
            }
            
            match result {
                Ok(chunk) => {
                    if !chunk.is_empty() {
                        full_content.push_str(&chunk);
                        
                        // Call callback and check if it signals cancellation
                        if !callback(chunk) {
                            println!("🛑 [openrouter_rig] Callback signaled cancellation");
                            cancelled = true;
                            break;
                        }
                    }
                }
                Err(e) => {
                    eprintln!("❌ [openrouter_rig] Stream error: {}", e);
                    return Err(e.into());
                }
            }
        }
        
        if cancelled {
            println!("⚠️ [openrouter_rig] Stream was cancelled");
        } else {
            println!("✅ [openrouter_rig] Stream completed successfully");
        }
        
        // Parse thinking content
        let parsed = thinking_parser::parse_thinking_content(&full_content);
        
        println!("📊 [openrouter_rig] Parsed content: {} chars, thinking: {}", 
                 parsed.content.len(), 
                 parsed.thinking_content.is_some());
        
        Ok(ChatResponse {
            content: parsed.content,
            thinking_content: parsed.thinking_content,
            tokens: None,
        })
    }
}

