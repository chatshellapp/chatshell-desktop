pub mod agent_builder;
pub mod common;
pub mod models;
pub mod ollama;
pub mod openai;
pub mod openrouter;

pub use common::StreamChunkType;

use agent_builder::{
    build_assistant_message, build_user_message, create_provider_agent, stream_chat_with_agent,
    AgentConfig,
};
use anyhow::Result;
use rig::completion::Message as RigMessage;
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
pub struct ChatResponse {
    pub content: String,
    pub thinking_content: Option<String>,
    pub tokens: Option<i64>,
}

/// Unified function to call any LLM provider (non-streaming)
/// Uses the agent-based approach for consistency across the codebase.
/// This eliminates code duplication across different features (title generation, search decision, etc.)
pub async fn call_provider(
    provider: &str,
    model: String,
    messages: Vec<ChatMessage>,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<ChatResponse> {
    // Extract system prompt if present
    let system_prompt = messages
        .first()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone());

    // Build agent config (no custom model params for simple calls)
    let config = AgentConfig::new();
    let config = if let Some(prompt) = system_prompt.clone() {
        config.with_system_prompt(prompt)
    } else {
        config
    };

    // Create the agent
    let agent = create_provider_agent(provider, &model, api_key.as_deref(), base_url.as_deref(), &config)?;

    // Convert ChatMessages to rig Message format
    let mut chat_history: Vec<RigMessage> = Vec::new();
    let mut current_prompt: Option<RigMessage> = None;

    for (i, msg) in messages.iter().enumerate() {
        let is_last = i == messages.len() - 1;
        let message = match msg.role.as_str() {
            "user" => build_user_message(&msg.content, &msg.images, &msg.files),
            "assistant" => build_assistant_message(&msg.content),
            "system" => {
                // System messages are handled via preamble in agent config
                if system_prompt.is_some() {
                    continue;
                }
                build_user_message(&format!("[System]: {}", msg.content), &[], &[])
            }
            _ => build_user_message(&msg.content, &msg.images, &msg.files),
        };

        if is_last && msg.role == "user" {
            current_prompt = Some(message);
        } else {
            chat_history.push(message);
        }
    }

    // Use the last user message as prompt
    let prompt = current_prompt.ok_or_else(|| anyhow::anyhow!("No user message found in request"))?;

    // Create a no-op cancel token (not really cancellable for non-streaming)
    let cancel_token = CancellationToken::new();

    // Use stream_chat_with_agent with a no-op callback
    // This collects the full response
    stream_chat_with_agent(agent, prompt, chat_history, cancel_token, |_, _| true, provider).await
}
