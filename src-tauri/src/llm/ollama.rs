use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use futures::StreamExt;

use crate::llm::{ChatRequest, ChatResponse, LLMProvider};
use crate::thinking_parser;

#[derive(Debug, Clone)]
pub struct OllamaProvider {
    base_url: String,
    client: Client,
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: Option<OllamaMessage>,
    done: bool,
}

impl OllamaProvider {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            base_url: base_url.unwrap_or_else(|| "http://localhost:11434".to_string()),
            client: Client::new(),
        }
    }
}

#[async_trait::async_trait]
impl LLMProvider for OllamaProvider {
    async fn chat_stream(
        &self,
        request: ChatRequest,
        callback: Box<dyn Fn(String) + Send>,
    ) -> Result<ChatResponse> {
        let messages: Vec<OllamaMessage> = request
            .messages
            .iter()
            .map(|m| OllamaMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();

        let req = OllamaRequest {
            model: request.model,
            messages,
            stream: true,
        };

        println!("🌐 [ollama] Sending request to {}/api/chat", self.base_url);
        let response = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .header("Content-Type", "application/json")
            .json(&req)
            .send()
            .await?;

        println!("✅ [ollama] Got response with status: {}", response.status());
        
        if !response.status().is_success() {
            let error_text = response.text().await?;
            eprintln!("❌ [ollama] API error: {}", error_text);
            return Err(anyhow::anyhow!("Ollama API error: {}", error_text));
        }

        println!("📥 [ollama] Processing streaming response...");
        let mut stream = response.bytes_stream();
        let mut full_raw_content = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            let text = String::from_utf8_lossy(&chunk);
            
            for line in text.lines() {
                if let Ok(response) = serde_json::from_str::<OllamaResponse>(line) {
                    if let Some(message) = response.message {
                        if !message.content.is_empty() {
                            full_raw_content.push_str(&message.content);
                            callback(message.content);
                        }
                    }
                    if response.done {
                        println!("✅ [ollama] Stream complete");
                        break;
                    }
                }
            }
        }
        
        // Parse thinking content from the complete response
        let parsed = thinking_parser::parse_thinking_content(&full_raw_content);

        Ok(ChatResponse {
            content: parsed.content,
            thinking_content: parsed.thinking_content,
            tokens: None,
        })
    }
}

