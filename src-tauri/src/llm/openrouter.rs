use anyhow::Result;
use rig::client::CompletionClient;
use rig::providers::openai;
use tokio_util::sync::CancellationToken;

use crate::llm::{ChatRequest, ChatResponse};
use crate::llm::common::chat_stream_common;

pub struct OpenRouterRigProvider {
    api_key: String,
}

impl OpenRouterRigProvider {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }

    pub async fn chat_stream(
        &self,
        request: ChatRequest,
        cancel_token: CancellationToken,
        callback: impl FnMut(String) -> bool + Send,
    ) -> Result<ChatResponse> {
        println!("🌐 [openrouter] Creating client with custom base URL");
        
        // Create OpenAI-compatible client with OpenRouter base URL
        let client = openai::Client::builder(&self.api_key)
            .base_url("https://openrouter.ai/api/v1")
            .build();
        
        // Get completion model
        let model = client.completion_model(&request.model);
        
        // Use common streaming handler
        chat_stream_common(model, request, cancel_token, callback, "openrouter").await
    }
}
