//! Agent builder module for unified LLM agent creation across all providers.
//!
//! This module provides a unified interface for creating rig agents with full configuration
//! (preamble, temperature, max_tokens, etc.) regardless of the underlying provider.

use anyhow::Result;
use rig::OneOrMany;
use rig::agent::Agent;
use rig::client::{CompletionClient, Nothing};
use rig::completion::{CompletionModel, Message};
use rig::message::AssistantContent;
use rig::providers::{
    anthropic, azure, cohere, deepseek, galadriel, gemini, groq, hyperbolic, mira, mistral,
    moonshot, ollama, openai, openrouter, perplexity, together, xai,
};
use rmcp::RoleClient;
use rmcp::model::Tool as McpTool;
use rmcp::service::Peer;
use tokio_util::sync::CancellationToken;

use crate::llm::ChatResponse;
use crate::llm::agent_streaming;
use crate::llm::common::{StreamChunkType, build_user_content, create_http_client};
use crate::llm::tool_registry::ToolRegistry;
use crate::llm::tools::{BashTool, WebFetchTool, WebSearchTool};
use crate::llm::{
    anthropic as anthropic_provider, azure as azure_provider, cohere as cohere_provider,
    deepseek as deepseek_provider, galadriel as galadriel_provider, gemini as gemini_provider,
    groq as groq_provider, hyperbolic as hyperbolic_provider, minimax as minimax_provider,
    minimax_cn as minimax_cn_provider, mira as mira_provider, mistral as mistral_provider,
    moonshot as moonshot_provider, ollama as ollama_provider, openai as openai_provider,
    openrouter as openrouter_provider, perplexity as perplexity_provider,
    together as together_provider, xai as xai_provider,
};
use crate::models::ModelParameters;

/// MCP tools configuration for agent
#[derive(Clone)]
pub struct McpToolsConfig {
    /// MCP tools from connected servers
    pub tools: Vec<McpTool>,
    /// Client peer for calling tools
    pub client: Peer<RoleClient>,
}

/// Configuration for building an agent.
/// Combines system prompt with model parameters and tool registry.
#[derive(Clone, Default)]
pub struct AgentConfig {
    /// System prompt (preamble) for the agent
    pub system_prompt: Option<String>,
    /// Model parameters (temperature, max_tokens, etc.)
    pub model_params: ModelParameters,
    /// Optional tool registry for function calling
    pub tool_registry: Option<ToolRegistry>,
    /// Optional list of specific tool names to enable (if None, all tools are enabled)
    pub enabled_tools: Option<Vec<String>>,
    /// Optional MCP tools configuration
    pub mcp_tools: Option<McpToolsConfig>,
    /// Enable built-in web search tool
    pub enable_web_search: bool,
    /// Enable built-in web fetch tool
    pub enable_web_fetch: bool,
    /// Enable built-in bash tool
    pub enable_bash: bool,
    /// Default working directory for bash tool
    pub bash_working_directory: Option<String>,
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

    pub fn with_mcp_tools(mut self, tools: Vec<McpTool>, client: Peer<RoleClient>) -> Self {
        self.mcp_tools = Some(McpToolsConfig { tools, client });
        self
    }

    /// Enable the built-in web search tool
    pub fn with_web_search(mut self) -> Self {
        self.enable_web_search = true;
        self
    }

    /// Enable the built-in web fetch tool
    pub fn with_web_fetch(mut self) -> Self {
        self.enable_web_fetch = true;
        self
    }

    /// Enable the built-in bash tool
    pub fn with_bash(mut self) -> Self {
        self.enable_bash = true;
        self
    }

    /// Set the default working directory for bash tool
    pub fn with_bash_working_directory(mut self, dir: String) -> Self {
        self.bash_working_directory = Some(dir);
        self
    }

    /// Enable all built-in tools (web_search, web_fetch, and bash)
    pub fn with_builtin_tools(mut self) -> Self {
        self.enable_web_search = true;
        self.enable_web_fetch = true;
        self.enable_bash = true;
        self
    }
}

// Type aliases for the completion model types used by each provider
type AnthropicCompletionModel = anthropic::completion::CompletionModel;
type AzureCompletionModel = azure::CompletionModel;
type CohereCompletionModel = cohere::CompletionModel;
type DeepSeekCompletionModel = deepseek::CompletionModel;
type GaladrielCompletionModel = galadriel::CompletionModel;
type GeminiCompletionModel = gemini::completion::CompletionModel;
type GroqCompletionModel = groq::CompletionModel;
type HyperbolicCompletionModel = hyperbolic::CompletionModel;
// MiniMax uses OpenAI-compatible API; reuse moonshot's CompletionModel
type MiniMaxCompletionModel = moonshot::CompletionModel;
type MiraCompletionModel = mira::CompletionModel;
type MistralCompletionModel = mistral::CompletionModel;
type MoonshotCompletionModel = moonshot::CompletionModel;
type OllamaCompletionModel = ollama::CompletionModel;
// OpenAI uses ResponsesCompletionModel by default for agent()
type OpenAICompletionModel = openai::responses_api::ResponsesCompletionModel;
type OpenRouterCompletionModel = openrouter::CompletionModel;
type PerplexityCompletionModel = perplexity::CompletionModel;
type TogetherCompletionModel = together::CompletionModel;
type XAICompletionModel = xai::completion::CompletionModel;

/// Enum to hold different provider agent types.
/// This allows us to handle all providers uniformly while maintaining type safety.
pub enum ProviderAgent {
    Anthropic(Agent<AnthropicCompletionModel>),
    Azure(Agent<AzureCompletionModel>),
    Cohere(Agent<CohereCompletionModel>),
    DeepSeek(Agent<DeepSeekCompletionModel>),
    Galadriel(Agent<GaladrielCompletionModel>),
    Gemini(Agent<GeminiCompletionModel>),
    Groq(Agent<GroqCompletionModel>),
    Hyperbolic(Agent<HyperbolicCompletionModel>),
    MiniMax(Agent<MiniMaxCompletionModel>),
    MiniMaxCn(Agent<MiniMaxCompletionModel>),
    Mira(Agent<MiraCompletionModel>),
    Mistral(Agent<MistralCompletionModel>),
    Moonshot(Agent<MoonshotCompletionModel>),
    Ollama(Agent<OllamaCompletionModel>),
    OpenAI(Agent<OpenAICompletionModel>),
    OpenRouter(Agent<OpenRouterCompletionModel>),
    Perplexity(Agent<PerplexityCompletionModel>),
    Together(Agent<TogetherCompletionModel>),
    XAI(Agent<XAICompletionModel>),
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

/// Create an agent for custom OpenAI-compatible providers using the Chat Completions API.
/// Reuses moonshot::Client which implements the standard OpenAI chat completions format.
fn create_custom_openai_chat_completions_agent(
    api_key: &str,
    base_url: &str,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<MoonshotCompletionModel>> {
    let http_client = create_http_client();
    let client = moonshot::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url)
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
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

/// Create an Anthropic agent with full configuration
pub fn create_anthropic_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<AnthropicCompletionModel>> {
    let http_client = create_http_client();
    let client = anthropic::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(anthropic_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create an Azure OpenAI agent with full configuration.
/// The base_url is used as the Azure endpoint.
pub fn create_azure_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<AzureCompletionModel>> {
    let http_client = create_http_client();
    let endpoint = base_url.ok_or_else(|| {
        anyhow::anyhow!("Azure OpenAI requires an endpoint URL (set as base URL)")
    })?;
    let client = azure::Client::<reqwest::Client>::builder()
        .api_key(azure::AzureOpenAIAuth::ApiKey(api_key.to_string()))
        .azure_endpoint(endpoint.to_string())
        .api_version(azure_provider::DEFAULT_API_VERSION)
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Cohere agent with full configuration
pub fn create_cohere_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<CohereCompletionModel>> {
    let http_client = create_http_client();
    let client = cohere::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(cohere_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a DeepSeek agent with full configuration
pub fn create_deepseek_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<DeepSeekCompletionModel>> {
    let http_client = create_http_client();
    let client = deepseek::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(deepseek_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Galadriel agent with full configuration
pub fn create_galadriel_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<GaladrielCompletionModel>> {
    let http_client = create_http_client();
    let client = galadriel::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(galadriel_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Google Gemini agent with full configuration
pub fn create_gemini_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<GeminiCompletionModel>> {
    let http_client = create_http_client();
    let client = gemini::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(gemini_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Groq agent with full configuration
pub fn create_groq_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<GroqCompletionModel>> {
    let http_client = create_http_client();
    let client = groq::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(groq_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Hyperbolic agent with full configuration
pub fn create_hyperbolic_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<HyperbolicCompletionModel>> {
    let http_client = create_http_client();
    let client = hyperbolic::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(hyperbolic_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a MiniMax agent with full configuration (international version)
/// MiniMax uses OpenAI-compatible API, so we reuse moonshot's client.
pub fn create_minimax_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<MiniMaxCompletionModel>> {
    let http_client = create_http_client();
    let client = moonshot::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(minimax_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a MiniMax CN agent with full configuration (China version)
/// MiniMax CN uses OpenAI-compatible API, so we reuse moonshot's client.
pub fn create_minimax_cn_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<MiniMaxCompletionModel>> {
    let http_client = create_http_client();
    let client = moonshot::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(minimax_cn_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Mira agent with full configuration
pub fn create_mira_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<MiraCompletionModel>> {
    let http_client = create_http_client();
    let client = mira::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(mira_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Mistral agent with full configuration
pub fn create_mistral_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<MistralCompletionModel>> {
    let http_client = create_http_client();
    let client = mistral::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(mistral_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Moonshot agent with full configuration
pub fn create_moonshot_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<MoonshotCompletionModel>> {
    let http_client = create_http_client();
    let client = moonshot::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(moonshot_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Perplexity agent with full configuration
pub fn create_perplexity_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<PerplexityCompletionModel>> {
    let http_client = create_http_client();
    let client = perplexity::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(perplexity_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create a Together AI agent with full configuration
pub fn create_together_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<TogetherCompletionModel>> {
    let http_client = create_http_client();
    let client = together::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(together_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create an xAI agent with full configuration
pub fn create_xai_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent<XAICompletionModel>> {
    let http_client = create_http_client();
    let client = xai::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(xai_provider::DEFAULT_BASE_URL))
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
            tracing::info!("🔧 Tool registry prepared with {} tool(s)", tools.len());
            // TODO: Apply tools when rig library supports it
            // builder = builder.tools(tools);
        }
    }

    // Check if we need to add any native tools or MCP tools
    // Note: .tool() transforms AgentBuilder into AgentBuilderSimple,
    // so we need to handle the transition carefully
    let has_native_tools =
        config.enable_web_search || config.enable_web_fetch || config.enable_bash;
    let has_mcp_tools = config
        .mcp_tools
        .as_ref()
        .is_some_and(|m| !m.tools.is_empty());

    if has_native_tools || has_mcp_tools {
        // Add native tools first (this transitions to AgentBuilderSimple)
        return build_agent_with_tools(builder, config);
    }

    builder.build()
}

/// Build agent with native tools and/or MCP tools
/// This is a separate function because .tool() changes the builder type.
///
/// The first `.tool()` call transitions `AgentBuilder` into `AgentBuilderSimple`,
/// so we use a helper macro to avoid exponential branching across native tools.
fn build_agent_with_tools<M: CompletionModel>(
    builder: rig::agent::AgentBuilder<M>,
    config: &AgentConfig,
) -> Agent<M> {
    // Collect which native tools are enabled
    let mut native_tool_count = 0u32;

    // We need to add the first native tool to transition the builder type,
    // then chain the remaining native tools and MCP tools.
    // Use a macro to avoid repeating the "add remaining tools + MCP + build" logic.
    macro_rules! finish_with_simple_builder {
        ($simple_builder:expr) => {{
            let sb = $simple_builder;

            // Add MCP tools if configured
            if let Some(ref mcp_config) = config.mcp_tools
                && !mcp_config.tools.is_empty()
            {
                tracing::info!(
                    "🔌 Adding {} MCP tool(s) to agent (total: {} native + {} MCP)",
                    mcp_config.tools.len(),
                    native_tool_count,
                    mcp_config.tools.len()
                );
                return sb
                    .rmcp_tools(mcp_config.tools.clone(), mcp_config.client.clone())
                    .build();
            }

            return sb.build();
        }};
    }

    // Determine which native tools to add
    let enable_web_search = config.enable_web_search;
    let enable_web_fetch = config.enable_web_fetch;
    let enable_bash = config.enable_bash;

    // Helper to create BashTool with optional working directory
    let create_bash_tool = || -> BashTool {
        if let Some(ref dir) = config.bash_working_directory {
            tracing::info!("🖥️ Bash tool configured with working directory: {}", dir);
            BashTool::with_working_directory(dir.clone())
        } else {
            BashTool::new()
        }
    };

    // The first `.tool()` call transitions the builder type.
    // After that, we can chain additional `.tool()` calls freely.
    if enable_web_search {
        tracing::info!("🔍 Adding web_search tool to agent");
        native_tool_count += 1;
        let mut simple_builder = builder.tool(WebSearchTool::new());

        if enable_web_fetch {
            tracing::info!("🌐 Adding web_fetch tool to agent");
            native_tool_count += 1;
            simple_builder = simple_builder.tool(WebFetchTool::new());
        }
        if enable_bash {
            tracing::info!("🖥️ Adding bash tool to agent");
            native_tool_count += 1;
            simple_builder = simple_builder.tool(create_bash_tool());
        }

        finish_with_simple_builder!(simple_builder);
    }

    if enable_web_fetch {
        tracing::info!("🌐 Adding web_fetch tool to agent");
        native_tool_count += 1;
        let mut simple_builder = builder.tool(WebFetchTool::new());

        if enable_bash {
            tracing::info!("🖥️ Adding bash tool to agent");
            native_tool_count += 1;
            simple_builder = simple_builder.tool(create_bash_tool());
        }

        finish_with_simple_builder!(simple_builder);
    }

    if enable_bash {
        tracing::info!("🖥️ Adding bash tool to agent");
        native_tool_count += 1;
        let simple_builder = builder.tool(create_bash_tool());

        finish_with_simple_builder!(simple_builder);
    }

    // Only MCP tools (no native tools)
    if let Some(ref mcp_config) = config.mcp_tools
        && !mcp_config.tools.is_empty()
    {
        tracing::info!("🔌 Adding {} MCP tool(s) to agent", mcp_config.tools.len());
        return builder
            .rmcp_tools(mcp_config.tools.clone(), mcp_config.client.clone())
            .build();
    }

    // Fallback (shouldn't reach here based on calling logic)
    builder.build()
}

/// Create a provider agent based on provider type.
/// `api_style` is only used for `custom_openai` to choose between Responses API and Chat Completions API.
pub fn create_provider_agent(
    provider_type: &str,
    model_id: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    api_style: Option<&str>,
    config: &AgentConfig,
) -> Result<ProviderAgent> {
    macro_rules! require_key {
        ($name:expr) => {
            api_key.ok_or_else(|| anyhow::anyhow!("{} API key required", $name))?
        };
    }

    match provider_type {
        "anthropic" => Ok(ProviderAgent::Anthropic(create_anthropic_agent(
            require_key!("Anthropic"),
            base_url,
            model_id,
            config,
        )?)),
        "azure" => Ok(ProviderAgent::Azure(create_azure_agent(
            require_key!("Azure OpenAI"),
            base_url,
            model_id,
            config,
        )?)),
        "cohere" => Ok(ProviderAgent::Cohere(create_cohere_agent(
            require_key!("Cohere"),
            base_url,
            model_id,
            config,
        )?)),
        "deepseek" => Ok(ProviderAgent::DeepSeek(create_deepseek_agent(
            require_key!("DeepSeek"),
            base_url,
            model_id,
            config,
        )?)),
        "galadriel" => Ok(ProviderAgent::Galadriel(create_galadriel_agent(
            require_key!("Galadriel"),
            base_url,
            model_id,
            config,
        )?)),
        "gemini" => Ok(ProviderAgent::Gemini(create_gemini_agent(
            require_key!("Google Gemini"),
            base_url,
            model_id,
            config,
        )?)),
        "groq" => Ok(ProviderAgent::Groq(create_groq_agent(
            require_key!("Groq"),
            base_url,
            model_id,
            config,
        )?)),
        "hyperbolic" => Ok(ProviderAgent::Hyperbolic(create_hyperbolic_agent(
            require_key!("Hyperbolic"),
            base_url,
            model_id,
            config,
        )?)),
        "minimax" => Ok(ProviderAgent::MiniMax(create_minimax_agent(
            require_key!("MiniMax"),
            base_url,
            model_id,
            config,
        )?)),
        "minimax_cn" => Ok(ProviderAgent::MiniMaxCn(create_minimax_cn_agent(
            require_key!("MiniMax CN"),
            base_url,
            model_id,
            config,
        )?)),
        "mira" => Ok(ProviderAgent::Mira(create_mira_agent(
            require_key!("Mira"),
            base_url,
            model_id,
            config,
        )?)),
        "mistral" => Ok(ProviderAgent::Mistral(create_mistral_agent(
            require_key!("Mistral"),
            base_url,
            model_id,
            config,
        )?)),
        "moonshot" => Ok(ProviderAgent::Moonshot(create_moonshot_agent(
            require_key!("Moonshot"),
            base_url,
            model_id,
            config,
        )?)),
        "ollama" => Ok(ProviderAgent::Ollama(create_ollama_agent(
            base_url, model_id, config,
        )?)),
        "openai" => Ok(ProviderAgent::OpenAI(create_openai_agent(
            require_key!("OpenAI"),
            base_url,
            model_id,
            config,
        )?)),
        "openrouter" => Ok(ProviderAgent::OpenRouter(create_openrouter_agent(
            require_key!("OpenRouter"),
            base_url,
            model_id,
            config,
        )?)),
        "perplexity" => Ok(ProviderAgent::Perplexity(create_perplexity_agent(
            require_key!("Perplexity"),
            base_url,
            model_id,
            config,
        )?)),
        "together" => Ok(ProviderAgent::Together(create_together_agent(
            require_key!("Together AI"),
            base_url,
            model_id,
            config,
        )?)),
        "xai" => Ok(ProviderAgent::XAI(create_xai_agent(
            require_key!("xAI"),
            base_url,
            model_id,
            config,
        )?)),
        "custom_openai" => {
            let key = require_key!("Custom OpenAI-compatible");
            let url = base_url.ok_or_else(|| {
                anyhow::anyhow!("Base URL is required for custom OpenAI-compatible providers")
            })?;
            if api_style == Some("chat_completions") {
                // Chat Completions API: reuse moonshot client (OpenAI-compatible)
                Ok(ProviderAgent::Moonshot(
                    create_custom_openai_chat_completions_agent(key, url, model_id, config)?,
                ))
            } else {
                // Responses API (default)
                Ok(ProviderAgent::OpenAI(create_openai_agent(
                    key,
                    Some(url),
                    model_id,
                    config,
                )?))
            }
        }
        "custom_anthropic" => {
            let key = require_key!("Custom Anthropic-compatible");
            let url = base_url.ok_or_else(|| {
                anyhow::anyhow!("Base URL is required for custom Anthropic-compatible providers")
            })?;
            Ok(ProviderAgent::Anthropic(create_anthropic_agent(
                key,
                Some(url),
                model_id,
                config,
            )?))
        }
        _ => Err(anyhow::anyhow!("Unknown provider: {}", provider_type)),
    }
}

/// Stream chat with an agent, handling all provider types uniformly.
/// Returns the complete response after streaming.
pub async fn stream_chat_with_agent(
    agent: ProviderAgent,
    prompt: Message,
    chat_history: Vec<Message>,
    cancel_token: CancellationToken,
    callback: impl FnMut(String, StreamChunkType) -> bool + Send,
    log_prefix: &str,
) -> Result<ChatResponse> {
    macro_rules! stream {
        ($agent:expr) => {
            agent_streaming::stream_agent(
                $agent,
                prompt,
                chat_history,
                cancel_token,
                callback,
                log_prefix,
            )
            .await
        };
    }

    match agent {
        ProviderAgent::Anthropic(a) => stream!(a),
        ProviderAgent::Azure(a) => stream!(a),
        ProviderAgent::Cohere(a) => stream!(a),
        ProviderAgent::DeepSeek(a) => stream!(a),
        ProviderAgent::Galadriel(a) => stream!(a),
        ProviderAgent::Gemini(a) => stream!(a),
        ProviderAgent::Groq(a) => stream!(a),
        ProviderAgent::Hyperbolic(a) => stream!(a),
        ProviderAgent::MiniMax(a) => stream!(a),
        ProviderAgent::MiniMaxCn(a) => stream!(a),
        ProviderAgent::Mira(a) => stream!(a),
        ProviderAgent::Mistral(a) => stream!(a),
        ProviderAgent::Moonshot(a) => stream!(a),
        ProviderAgent::Ollama(a) => stream!(a),
        ProviderAgent::OpenAI(a) => stream!(a),
        ProviderAgent::OpenRouter(a) => stream!(a),
        ProviderAgent::Perplexity(a) => stream!(a),
        ProviderAgent::Together(a) => stream!(a),
        ProviderAgent::XAI(a) => stream!(a),
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
