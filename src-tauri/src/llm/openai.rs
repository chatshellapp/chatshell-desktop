use anyhow::Result;
use rig::client::CompletionClient;
use rig::providers::openai;
use tokio_util::sync::CancellationToken;

use crate::llm::{ChatRequest, ChatResponse};
use crate::llm::common::chat_stream_common;

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
        callback: impl FnMut(String) -> bool + Send,
    ) -> Result<ChatResponse> {
        println!("🌐 [openai] Creating OpenAI client");
        
        // Create OpenAI client
        let client = openai::Client::new(&self.api_key);
        
        // Get completion model
        let model = client.completion_model(&request.model);
        
        // Use common streaming handler
        chat_stream_common(model, request, cancel_token, callback, "openai").await
    }
}
