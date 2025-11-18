use anyhow::Result;
use futures::StreamExt;
use rig::client::CompletionClient;
use rig::completion::{CompletionModel, CompletionRequest, Message};
use rig::message::{AssistantContent, UserContent};
use rig::providers::openai;
use rig::streaming::StreamedAssistantContent;
use rig::OneOrMany;
use tokio_util::sync::CancellationToken;

use crate::llm::{ChatRequest, ChatResponse};
use crate::thinking_parser;

pub struct OpenAIRigProvider {
    api_key: String,
}

impl OpenAIRigProvider {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }

    pub async fn chat_stream(
        &self,
        request: ChatRequest,
        cancel_token: CancellationToken,
        mut callback: impl FnMut(String) -> bool + Send,
    ) -> Result<ChatResponse> {
        println!("🌐 [openai_rig] Creating OpenAI client");
        
        // Create OpenAI client
        let client = openai::Client::new(&self.api_key);
        
        // Get completion model
        let model = client.completion_model(&request.model);
        
        println!("🤖 [openai_rig] Model created: {}", request.model);
        
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
        
        println!("📝 [openai_rig] Prompt: {} chars, history: {} messages", 
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
        
        println!("📤 [openai_rig] Starting streaming request...");
        
        // Create stream
        let mut stream = model.stream(completion_request).await?;
        
        let mut full_content = String::new();
        let mut cancelled = false;
        
        println!("📥 [openai_rig] Processing stream...");
        
        // Process stream with cancellation support
        while let Some(result) = stream.next().await {
            if cancel_token.is_cancelled() {
                println!("🛑 [openai_rig] Cancellation detected, stopping stream");
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
                            println!("🛑 [openai_rig] Callback signaled cancellation");
                            cancelled = true;
                            break;
                        }
                    }
                }
                Ok(_) => {
                    // Ignore tool calls, reasoning, and final responses
                }
                Err(e) => {
                    eprintln!("❌ [openai_rig] Stream error: {}", e);
                    return Err(e.into());
                }
            }
        }
        
        if cancelled {
            println!("⚠️ [openai_rig] Stream was cancelled");
        } else {
            println!("✅ [openai_rig] Stream completed successfully");
        }
        
        // Parse thinking content
        let parsed = thinking_parser::parse_thinking_content(&full_content);
        
        println!("📊 [openai_rig] Parsed content: {} chars, thinking: {}", 
                 parsed.content.len(), 
                 parsed.thinking_content.is_some());
        
        Ok(ChatResponse {
            content: parsed.content,
            thinking_content: parsed.thinking_content,
            tokens: None,
        })
    }
}

