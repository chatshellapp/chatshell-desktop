pub mod models;
pub mod ollama;
pub mod openai;
pub mod openrouter;

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub thinking_content: Option<String>,
    pub tokens: Option<i64>,
}

/// Trait for LLM providers
#[async_trait::async_trait]
pub trait LLMProvider: Send + Sync {
    async fn chat_stream(
        &self,
        request: ChatRequest,
        callback: Box<dyn Fn(String) + Send>,
    ) -> Result<ChatResponse>;
}

