use anyhow::Result;
use futures::StreamExt;
use rig::client::CompletionClient;
use rig::completion::{CompletionModel, CompletionRequest, Message};
use rig::message::{AssistantContent, UserContent};
use rig::providers::ollama;
use rig::streaming::StreamedAssistantContent;
use rig::OneOrMany;
use tokio_util::sync::CancellationToken;

use crate::llm::{ChatRequest, ChatResponse};
use crate::thinking_parser;

pub struct OllamaRigProvider {
    base_url: String,
}

impl OllamaRigProvider {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            base_url: base_url.unwrap_or_else(|| "http://localhost:11434".to_string()),
        }
    }

    pub async fn chat_stream(
        &self,
        request: ChatRequest,
        cancel_token: CancellationToken,
        mut callback: impl FnMut(String) -> bool + Send,
    ) -> Result<ChatResponse> {
        println!("🌐 [ollama_rig] Creating client with base_url: {}", self.base_url);
        
        // Create Ollama client with custom base URL
        let client = ollama::Client::builder()
            .base_url(&self.base_url)
            .build();
        
        // Get completion model
        let model = client.completion_model(&request.model);
        
        println!("🤖 [ollama_rig] Model created: {}", request.model);
        
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
        
        println!("📝 [ollama_rig] Prompt: {} chars, history: {} messages", 
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
        
        println!("📤 [ollama_rig] Starting streaming request...");
        
        // Create stream
        let mut stream = model.stream(completion_request).await?;
        
        let mut full_content = String::new();
        let mut cancelled = false;
        
        println!("📥 [ollama_rig] Processing stream...");
        
        // Process stream with cancellation support
        while let Some(result) = stream.next().await {
            if cancel_token.is_cancelled() {
                println!("🛑 [ollama_rig] Cancellation detected, stopping stream");
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
                            println!("🛑 [ollama_rig] Callback signaled cancellation");
                            cancelled = true;
                            break;
                        }
                    }
                }
                Ok(_) => {
                    // Ignore tool calls, reasoning, and final responses
                }
                Err(e) => {
                    eprintln!("❌ [ollama_rig] Stream error: {}", e);
                    return Err(e.into());
                }
            }
        }
        
        if cancelled {
            println!("⚠️ [ollama_rig] Stream was cancelled");
        } else {
            println!("✅ [ollama_rig] Stream completed successfully");
        }
        
        // Parse thinking content
        let parsed = thinking_parser::parse_thinking_content(&full_content);
        
        println!("📊 [ollama_rig] Parsed content: {} chars, thinking: {}", 
                 parsed.content.len(), 
                 parsed.thinking_content.is_some());
        
        Ok(ChatResponse {
            content: parsed.content,
            thinking_content: parsed.thinking_content,
            tokens: None,
        })
    }
}

