use anyhow::Result;
use rig::client::CompletionClient;
use rig::providers::ollama;
use tokio_util::sync::CancellationToken;

use crate::llm::common::{chat_stream_common, StreamChunkType};
use crate::llm::{ChatRequest, ChatResponse};

const DEFAULT_BASE_URL: &str = "http://localhost:11434";

/// Create an Ollama client with the given configuration
pub fn create_client(base_url: Option<&str>) -> ollama::Client<reqwest::Client> {
    ollama::Client::builder()
        .base_url(base_url.unwrap_or(DEFAULT_BASE_URL))
        .build()
}

pub struct OllamaRigProvider {
    base_url: String,
}

impl OllamaRigProvider {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            base_url: base_url.unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
        }
    }

    pub async fn chat_stream(
        &self,
        request: ChatRequest,
        cancel_token: CancellationToken,
        callback: impl FnMut(String, StreamChunkType) -> bool + Send,
    ) -> Result<ChatResponse> {
        println!(
            "🌐 [ollama] Creating client with base_url: {}",
            self.base_url
        );

        // Create Ollama client with custom base URL
        let client = ollama::Client::builder().base_url(&self.base_url).build();

        // Get completion model
        let model = client.completion_model(&request.model);

        // Use common streaming handler
        chat_stream_common(model, request, cancel_token, callback, "ollama").await
    }
}
