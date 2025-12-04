use anyhow::Result;
use rig::client::CompletionClient;
use rig::providers::openai;
use tokio_util::sync::CancellationToken;

use crate::llm::common::{chat_stream_common, StreamChunkType};
use crate::llm::{ChatRequest, ChatResponse};

const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";

/// Create an OpenRouter client (uses OpenAI-compatible API)
pub fn create_client(api_key: &str, base_url: Option<&str>) -> openai::Client<reqwest::Client> {
    openai::Client::builder(api_key)
        .base_url(base_url.unwrap_or(DEFAULT_BASE_URL))
        .build()
}

pub struct OpenRouterRigProvider {
    api_key: String,
    base_url: String,
}

impl OpenRouterRigProvider {
    pub fn new(api_key: String, base_url: Option<String>) -> Self {
        Self {
            api_key,
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
            "🌐 [openrouter] Creating client with base_url: {}",
            self.base_url
        );

        // Create OpenAI-compatible client with custom base URL
        let client = openai::Client::builder(&self.api_key)
            .base_url(&self.base_url)
            .build();

        // Get completion model
        let model = client.completion_model(&request.model);

        // Use common streaming handler
        chat_stream_common(model, request, cancel_token, callback, "openrouter").await
    }
}
