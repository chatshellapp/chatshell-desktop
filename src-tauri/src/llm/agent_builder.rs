//! Agent builder module for unified LLM agent creation across all providers.
//!
//! This module provides a unified interface for creating rig agents with full configuration
//! (preamble, temperature, max_tokens, etc.) regardless of the underlying provider.

use anyhow::Result;
use rig::agent::Agent;
use rig::client::{CompletionClient, Nothing};
use rig::completion::{CompletionModel, Message};
use rig::message::AssistantContent;
use rig::providers::{ollama, openai, openrouter};
use rig::OneOrMany;
use tokio_util::sync::CancellationToken;

use crate::llm::agent_streaming;
use crate::llm::common::{build_user_content, create_http_client, StreamChunkType};
use crate::llm::tool_registry::ToolRegistry;
use crate::llm::{ollama as ollama_provider, openai as openai_provider, openrouter as openrouter_provider};
use crate::llm::ChatResponse;
use crate::models::ModelParameters;

/// Configuration for building an agent.
/// Combines system prompt with model parameters and tool registry.
#[derive(Debug, Clone, Default)]
pub struct AgentConfig {
    /// System prompt (preamble) for the agent
    pub system_prompt: Option<String>,
    /// Model parameters (temperature, max_tokens, etc.)
    pub model_params: ModelParameters,
    /// Optional tool registry for function calling
    pub tool_registry: Option<ToolRegistry>,
    /// Optional list of specific tool names to enable (if None, all tools are enabled)
    pub enabled_tools: Option<Vec<String>>,
}

impl AgentConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    pub fn with_model_params(mut self, params: ModelParameters) -> Self {
        self.model_params = params;
        self
    }

    pub fn with_temperature(mut self, temp: f64) -> Self {
        self.model_params.temperature = Some(temp);
        self
    }

    pub fn with_max_tokens(mut self, tokens: i64) -> Self {
        self.model_params.max_tokens = Some(tokens);
        self
    }

    pub fn with_additional_params(mut self, params: serde_json::Value) -> Self {
        self.model_params.additional_params = Some(params);
        self
    }

    pub fn with_tool_registry(mut self, registry: ToolRegistry) -> Self {
        self.tool_registry = Some(registry);
        self
    }

    pub fn with_enabled_tools(mut self, tools: Vec<String>) -> Self {
        self.enabled_tools = Some(tools);
        self
    }

    pub fn with_default_tools(mut self) -> Self {
        self.tool_registry = Some(ToolRegistry::with_defaults());
        self
    }
}

// Type aliases for the completion model types used by each provider
// OpenAI uses ResponsesCompletionModel by default for agent()
type OpenAICompletionModel = openai::responses_api::ResponsesCompletionModel;
type OpenRouterCompletionModel = openrouter::CompletionModel;
type OllamaCompletionModel = ollama::CompletionModel;

/// Enum to hold different provider agent types
/// This allows us to handle all providers uniformly while maintaining type safety
pub enum ProviderAgent {
    OpenAI(Agent<OpenAICompletionModel>),
    OpenRouter(Agent<OpenRouterCompletionModel>),
    Ollama(Agent<OllamaCompletionModel>),
}

/// Create an OpenAI agent with full configuration
/// Adds default reasoning: {"effort": "medium"} parameter for gpt-5 models (extended thinking support)
pub fn create_openai_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<OpenAICompletionModel>> {
    let http_client = create_http_client();
    let client = openai::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(openai_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    // Add default reasoning param for gpt-5 models if user hasn't set additional_params
    let mut openai_config = config.clone();
    if openai_config.model_params.additional_params.is_none() && model_id.starts_with("gpt-5") {
        openai_config.model_params.additional_params = Some(serde_json::json!({
            "reasoning": { "effort": "medium" }
        }));
    }

    Ok(build_agent(client.agent(model_id), &openai_config))
}

/// Create an OpenRouter agent with full configuration
/// Uses the dedicated OpenRouter provider for better compatibility
/// Adds default reasoning: {"effort": "medium"} parameter for extended thinking support
pub fn create_openrouter_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<OpenRouterCompletionModel>> {
    let http_client = create_http_client();
    let client = openrouter::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(openrouter_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    // Add default reasoning param if user hasn't set additional_params
    let mut openrouter_config = config.clone();
    if openrouter_config.model_params.additional_params.is_none() {
        openrouter_config.model_params.additional_params = Some(serde_json::json!({
            "reasoning": { "effort": "medium" }
        }));
    }

    Ok(build_agent(client.agent(model_id), &openrouter_config))
}

/// Create an Ollama agent with full configuration
pub fn create_ollama_agent(
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<OllamaCompletionModel>> {
    let http_client = create_http_client();
    let client = ollama::Client::<reqwest::Client>::builder()
        .api_key(Nothing)
        .base_url(base_url.unwrap_or(ollama_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Helper function to apply common configuration to any agent builder
fn build_agent<M: CompletionModel>(
    mut builder: rig::agent::AgentBuilder<M>,
    config: &AgentConfig,
) -> Agent<M> {
    // Apply system prompt (preamble)
    if let Some(ref preamble) = config.system_prompt {
        builder = builder.preamble(preamble);
    }

    // Apply model parameters
    let params = &config.model_params;

    // Apply temperature
    if let Some(temp) = params.temperature {
        builder = builder.temperature(temp);
    }

    // Apply max tokens (convert from i64 to u64)
    if let Some(tokens) = params.max_tokens {
        builder = builder.max_tokens(tokens as u64);
    }

    // Apply additional params
    if let Some(ref additional) = params.additional_params {
        builder = builder.additional_params(additional.clone());
    }

    // Apply tools if a tool registry is provided
    // Note: Tool registration is prepared here but actual integration with rig
    // requires provider-specific implementation. This is a placeholder for future
    // enhancement when rig adds full tool support for all providers.
    if let Some(ref registry) = config.tool_registry {
        // Get the list of tools to register
        let tools = if let Some(ref enabled) = config.enabled_tools {
            registry.to_openai_functions_by_names(enabled)
        } else {
            registry.to_openai_functions()
        };

        // Log tool registration (actual registration depends on provider support)
        if !tools.is_empty() {
            println!("🔧 Tool registry prepared with {} tool(s)", tools.len());
            // TODO: Apply tools when rig library supports it
            // builder = builder.tools(tools);
        }
    }

    builder.build()
}

/// Create a provider agent based on provider type
pub fn create_provider_agent(
    provider_type: &str,
    model_id: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    config: &AgentConfig,
) -> Result<ProviderAgent> {
    match provider_type {
        "openai" => {
            let api_key = api_key.ok_or_else(|| anyhow::anyhow!("OpenAI API key required"))?;
            Ok(ProviderAgent::OpenAI(create_openai_agent(
                api_key, base_url, model_id, config,
            )?))
        }
        "openrouter" => {
            let api_key = api_key.ok_or_else(|| anyhow::anyhow!("OpenRouter API key required"))?;
            Ok(ProviderAgent::OpenRouter(create_openrouter_agent(
                api_key, base_url, model_id, config,
            )?))
        }
        "ollama" => Ok(ProviderAgent::Ollama(create_ollama_agent(
            base_url, model_id, config,
        )?)),
        _ => Err(anyhow::anyhow!(
            "Unknown provider: {}. Use openai, openrouter, or ollama",
            provider_type
        )),
    }
}

/// Stream chat with an agent, handling all provider types uniformly
/// Returns the complete response after streaming
pub async fn stream_chat_with_agent(
    agent: ProviderAgent,
    prompt: Message,
    chat_history: Vec<Message>,
    cancel_token: CancellationToken,
    callback: impl FnMut(String, StreamChunkType) -> bool + Send,
    log_prefix: &str,
) -> Result<ChatResponse> {
    match agent {
        ProviderAgent::OpenAI(agent) => {
            agent_streaming::stream_agent(agent, prompt, chat_history, cancel_token, callback, log_prefix).await
        }
        ProviderAgent::OpenRouter(agent) => {
            agent_streaming::stream_agent(agent, prompt, chat_history, cancel_token, callback, log_prefix).await
        }
        ProviderAgent::Ollama(agent) => {
            agent_streaming::stream_agent(agent, prompt, chat_history, cancel_token, callback, log_prefix).await
        }
    }
}

/// Helper to convert chat messages to rig Message format
/// Uses build_user_content from common.rs for consistency
pub fn build_user_message(
    text: &str,
    images: &[crate::llm::ImageData],
    files: &[crate::llm::FileData],
) -> Message {
    Message::User {
        content: build_user_content(text, images, files),
    }
}

/// Helper to build assistant message
pub fn build_assistant_message(text: &str) -> Message {
    Message::Assistant {
        id: None,
        content: OneOrMany::one(AssistantContent::Text(text.to_string().into())),
    }
}
