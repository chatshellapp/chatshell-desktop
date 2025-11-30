pub mod common;
pub mod models;
pub mod ollama;
pub mod openai;
pub mod openrouter;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// Image data for multimodal messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageData {
    /// Base64 encoded image data (without data URL prefix)
    pub base64: String,
    /// MIME type (e.g., "image/png", "image/jpeg")
    pub media_type: String,
}

/// File/document data for multimodal messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileData {
    /// File name
    pub name: String,
    /// File content (text)
    pub content: String,
    /// MIME type (e.g., "text/plain", "text/markdown")
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Optional images for multimodal messages
    #[serde(default)]
    pub images: Vec<ImageData>,
    /// Optional files/documents for multimodal messages
    #[serde(default)]
    pub files: Vec<FileData>,
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

/// Unified function to call any LLM provider (non-streaming)
/// This eliminates code duplication across different features (title generation, search decision, etc.)
pub async fn call_provider(
    provider: &str,
    model: String,
    messages: Vec<ChatMessage>,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<ChatResponse> {
    let request = ChatRequest {
        model,
        messages,
        stream: false,
    };
    let cancel_token = CancellationToken::new();

    match provider {
        "openai" => {
            let api_key_val = api_key.ok_or_else(|| anyhow::anyhow!("OpenAI API key required"))?;
            let provider = openai::OpenAIRigProvider::new(api_key_val);
            provider.chat_stream(request, cancel_token, |_| true).await
        }
        "openrouter" => {
            let api_key_val =
                api_key.ok_or_else(|| anyhow::anyhow!("OpenRouter API key required"))?;
            let provider = openrouter::OpenRouterRigProvider::new(api_key_val);
            provider.chat_stream(request, cancel_token, |_| true).await
        }
        "ollama" => {
            let provider = ollama::OllamaRigProvider::new(base_url);
            provider.chat_stream(request, cancel_token, |_| true).await
        }
        _ => Err(anyhow::anyhow!(
            "Unknown provider: {}. Use openai, openrouter, or ollama",
            provider
        )),
    }
}
