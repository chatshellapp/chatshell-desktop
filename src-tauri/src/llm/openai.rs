use anyhow::Result;
use rig::client::CompletionClient;
use rig::providers::openai;
use tokio_util::sync::CancellationToken;

use crate::llm::common::{StreamChunkType, chat_stream_common};
use crate::llm::{ChatRequest, ChatResponse};

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

pub struct OpenAIRigProvider {
    api_key: String,
    base_url: String,
}

impl OpenAIRigProvider {
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
            "🌐 [openai] Creating OpenAI client with base_url: {}",
            self.base_url
        );

        // Create OpenAI client with custom base URL
        let client: openai::Client = openai::Client::builder()
            .api_key(&self.api_key)
            .base_url(&self.base_url)
            .build()?;

        // Get completion model
        let model = client.completion_model(&request.model);

        // Use common streaming handler
        chat_stream_common(model, request, cancel_token, callback, "openai").await
    }
}
