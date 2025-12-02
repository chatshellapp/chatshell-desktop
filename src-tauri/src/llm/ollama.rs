use anyhow::Result;
use rig::client::Nothing;
use rig::client::CompletionClient;
use rig::providers::ollama;
use tokio_util::sync::CancellationToken;

use crate::llm::common::{StreamChunkType, chat_stream_common};
use crate::llm::{ChatRequest, ChatResponse};

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
        callback: impl FnMut(String, StreamChunkType) -> bool + Send,
    ) -> Result<ChatResponse> {
        println!(
            "🌐 [ollama] Creating client with base_url: {}",
            self.base_url
        );

        // Create Ollama client with custom base URL (Ollama doesn't need API key)
        let client: ollama::Client = ollama::Client::builder()
            .api_key(Nothing)
            .base_url(&self.base_url)
            .build()?;

        // Get completion model
        let model = client.completion_model(&request.model);

        // Use common streaming handler
        chat_stream_common(model, request, cancel_token, callback, "ollama").await
    }
}
