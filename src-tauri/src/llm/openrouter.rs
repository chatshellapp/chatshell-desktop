use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;

use crate::llm::{ChatRequest, ChatResponse, LLMProvider};
use crate::thinking_parser;

pub struct OpenRouterProvider {
    api_key: String,
    base_url: String,
}

#[derive(Debug, Deserialize)]
struct OpenRouterStreamChunk {
    choices: Vec<OpenRouterChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterChoice {
    delta: OpenRouterDelta,
}

#[derive(Debug, Deserialize)]
struct OpenRouterDelta {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterResponse {
    choices: Vec<OpenRouterResponseChoice>,
    usage: Option<OpenRouterUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterResponseChoice {
    message: OpenRouterMessage,
}

#[derive(Debug, Deserialize)]
struct OpenRouterMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenRouterUsage {
    total_tokens: Option<i64>,
}

impl OpenRouterProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            base_url: "https://openrouter.ai/api/v1".to_string(),
        }
    }
}

#[async_trait::async_trait]
impl LLMProvider for OpenRouterProvider {
    async fn chat_stream(
        &self,
        request: ChatRequest,
        callback: Box<dyn Fn(String) -> bool + Send>,
    ) -> Result<ChatResponse> {
        let client = Client::new();

        let messages: Vec<serde_json::Value> = request
            .messages
            .iter()
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content,
                })
            })
            .collect();

        let body = json!({
            "model": request.model,
            "messages": messages,
            "stream": request.stream,
        });

        let response = client
            .post(format!("{}/chat/completions", self.base_url))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(anyhow::anyhow!("OpenRouter API error: {}", error_text));
        }

        if request.stream {
            // Stream processing
            let mut full_content = String::new();
            let bytes = response.bytes().await?;
            let text = String::from_utf8_lossy(&bytes);

            for line in text.lines() {
                if line.starts_with("data: ") {
                    let data = line.trim_start_matches("data: ");
                    if data == "[DONE]" {
                        break;
                    }

                    if let Ok(chunk) = serde_json::from_str::<OpenRouterStreamChunk>(data) {
                        if let Some(choice) = chunk.choices.first() {
                            if let Some(content) = &choice.delta.content {
                                full_content.push_str(content);
                                // Check if callback returns false (cancellation requested)
                                if !callback(content.clone()) {
                                    println!("🛑 [openrouter] Cancellation requested via callback");
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Parse thinking content
            let parsed = thinking_parser::parse_thinking_content(&full_content);

            Ok(ChatResponse {
                content: parsed.content,
                thinking_content: parsed.thinking_content,
                tokens: None,
            })
        } else {
            // Non-streaming response
            let response_data: OpenRouterResponse = response.json().await?;
            let content = response_data
                .choices
                .first()
                .map(|c| c.message.content.clone())
                .unwrap_or_default();

            let tokens = response_data
                .usage
                .and_then(|u| u.total_tokens);

            // Parse thinking content
            let parsed = thinking_parser::parse_thinking_content(&content);

            Ok(ChatResponse {
                content: parsed.content,
                thinking_content: parsed.thinking_content,
                tokens,
            })
        }
    }
}

