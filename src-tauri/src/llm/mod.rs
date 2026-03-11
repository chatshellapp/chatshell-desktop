pub mod agent_builder;
pub mod agent_streaming;
pub mod anthropic;
pub mod azure;
pub mod capabilities;
pub mod cohere;
pub mod common;
pub mod deepseek;
pub mod galadriel;
pub mod gemini;
pub mod groq;
pub mod hyperbolic;
pub mod minimax;
pub mod minimax_cn;
pub mod mira;
pub mod mistral;
pub mod models;
pub mod moonshot;
pub mod ollama;
pub mod openai;
pub mod openai_compat;
pub mod openrouter;
pub mod perplexity;
pub mod together;
pub mod tool_registry;
pub mod tools;
pub mod xai;

pub use common::StreamChunkType;

// Re-export tool registry types for public API
// These are currently unused internally but are part of the public API
#[allow(unused_imports)]
pub use tool_registry::{ToolDefinition, ToolParameter, ToolRegistry};

// Re-export native tools for public API
// These are currently unused internally but are part of the public API
#[allow(unused_imports)]
pub use tools::{WebFetchTool, WebSearchTool};

use agent_builder::{
    AgentConfig, build_assistant_message, build_assistant_message_with_tool_calls,
    build_tool_result_message, build_user_message, create_provider_agent, stream_chat_with_agent,
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
pub struct ToolCallData {
    pub id: String,
    pub tool_name: String,
    pub tool_input: String,
    pub tool_output: Option<String>,
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
    /// Tool calls made by the assistant (only for role="assistant")
    #[serde(default)]
    pub tool_calls: Vec<ToolCallData>,
    /// Tool call ID this message is a result for (only for role="tool")
    #[serde(default)]
    pub tool_call_id: Option<String>,
    /// Reasoning/thinking content from the assistant (only for role="assistant")
    #[serde(default)]
    pub reasoning_content: Option<String>,
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
    api_style: Option<String>,
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
    let agent = create_provider_agent(
        provider,
        &model,
        api_key.as_deref(),
        base_url.as_deref(),
        api_style.as_deref(),
        &config,
    )?;

    // Convert ChatMessages to rig Message format
    let mut chat_history: Vec<RigMessage> = Vec::new();
    let mut current_prompt: Option<RigMessage> = None;

    for (i, msg) in messages.iter().enumerate() {
        let is_last = i == messages.len() - 1;
        let message = match msg.role.as_str() {
            "user" => build_user_message(&msg.content, &msg.images, &msg.files),
            "assistant" => {
                if !msg.tool_calls.is_empty() {
                    build_assistant_message_with_tool_calls(
                        &msg.content,
                        &msg.tool_calls,
                        msg.reasoning_content.as_deref(),
                    )
                } else {
                    build_assistant_message(&msg.content, msg.reasoning_content.as_deref())
                }
            }
            "tool" => {
                let tc_id = msg.tool_call_id.as_deref().unwrap_or("");
                build_tool_result_message(tc_id, &msg.content)
            }
            "system" => {
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
    let prompt =
        current_prompt.ok_or_else(|| anyhow::anyhow!("No user message found in request"))?;

    // Create a no-op cancel token (not really cancellable for non-streaming)
    let cancel_token = CancellationToken::new();

    // Use stream_chat_with_agent with a no-op callback
    // This collects the full response
    stream_chat_with_agent(
        agent,
        prompt,
        chat_history,
        cancel_token,
        |_, _| true,
        provider,
    )
    .await
}
