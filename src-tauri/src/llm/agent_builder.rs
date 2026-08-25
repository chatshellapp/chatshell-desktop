//! Agent builder module for unified LLM agent creation across all providers.
//!
//! This module provides a unified interface for creating rig agents with full configuration
//! (preamble, temperature, max_tokens, etc.) regardless of the underlying provider.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use chatshell_agent_core::provider_catalog;
use rig::agent::{Agent, AgentBuilder};
use rig::client::{AgentClientExt, Nothing};
use rig::completion::Message;
use rig::message::AssistantContent;
use rig::providers::{
    azure, cohere, deepseek, gemini, groq, hyperbolic, mira, mistral, moonshot, ollama, openai,
    openrouter, perplexity, together, xai,
};
use tokio_util::sync::CancellationToken;

use crate::llm::ChatResponse;
use crate::llm::agent_streaming;
use crate::llm::common::{StreamChunkType, build_user_content, create_http_client};
use crate::llm::tools::{
    BashTool, EditTool, GlobTool, GrepTool, KillShellTool, McpSchemaTool, McpToolUseTool, ReadTool,
    SharedBashSession, SkillTool, TempFileList, WebFetchTool, WebSearchTool, WriteTool,
};
use crate::llm::{
    azure as azure_provider, cohere as cohere_provider, deepseek as deepseek_provider,
    galadriel as galadriel_provider, gemini as gemini_provider, groq as groq_provider,
    hyperbolic as hyperbolic_provider, minimax as minimax_provider,
    minimax_cn as minimax_cn_provider, mira as mira_provider, mistral as mistral_provider,
    moonshot as moonshot_provider, ollama as ollama_provider, openai as openai_provider,
    openrouter as openrouter_provider, perplexity as perplexity_provider,
    together as together_provider, xai as xai_provider,
};
use crate::models::ModelParameters;

/// Configuration for building an agent.
/// Combines system prompt with model parameters and tool configuration.
#[derive(Clone, Default)]
pub struct AgentConfig {
    /// System prompt (preamble) for the agent
    pub system_prompt: Option<String>,
    /// Model parameters (temperature, max_tokens, etc.)
    pub model_params: ModelParameters,
    /// Enable built-in web search tool
    pub enable_web_search: bool,
    /// Enable built-in web fetch tool
    pub enable_web_fetch: bool,
    /// Enable built-in bash tool
    pub enable_bash: bool,
    /// Default working directory for bash tool
    pub bash_working_directory: Option<String>,
    /// Enable built-in file read tool
    pub enable_read: bool,
    /// Enable built-in file edit tool
    pub enable_edit: bool,
    /// Enable built-in file write tool
    pub enable_write: bool,
    /// Enable built-in grep (content search) tool
    pub enable_grep: bool,
    /// Enable built-in glob (file pattern matching) tool
    pub enable_glob: bool,
    /// Enable built-in kill_shell tool
    pub enable_kill_shell: bool,
    /// Default working directory for grep tool
    pub grep_working_directory: Option<String>,
    /// Default working directory for glob tool
    pub glob_working_directory: Option<String>,
    /// Shared bash session handle (for conversation-level persistence)
    pub bash_session: Option<SharedBashSession>,
    /// Abort notification handle for cooperative bash cancellation
    pub bash_abort_notify: Option<Arc<tokio::sync::Notify>>,
    /// Shared temp file tracker for bash output truncation cleanup
    pub bash_temp_files: Option<TempFileList>,
    /// MCP schema lookup tool with embedded catalog
    pub mcp_schema_tool: Option<McpSchemaTool>,
    /// MCP tool execution tool
    pub mcp_tool_use: Option<McpToolUseTool>,
    /// Skill tool with embedded catalog
    pub skill_tool: Option<SkillTool>,
    /// Project root directory for path security enforcement
    pub project_root: Option<PathBuf>,
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

    /// Set the MCP schema lookup tool with embedded catalog
    pub fn with_mcp_schema_tool(mut self, tool: McpSchemaTool) -> Self {
        self.mcp_schema_tool = Some(tool);
        self
    }

    /// Set the MCP tool execution tool
    pub fn with_mcp_tool_use(mut self, tool: McpToolUseTool) -> Self {
        self.mcp_tool_use = Some(tool);
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

    /// Enable the built-in file read tool
    pub fn with_read(mut self) -> Self {
        self.enable_read = true;
        self
    }

    /// Enable the built-in file edit tool
    pub fn with_edit(mut self) -> Self {
        self.enable_edit = true;
        self
    }

    /// Enable the built-in file write tool
    pub fn with_write(mut self) -> Self {
        self.enable_write = true;
        self
    }

    /// Enable the built-in grep (content search) tool
    pub fn with_grep(mut self) -> Self {
        self.enable_grep = true;
        self
    }

    /// Enable the built-in glob (file pattern matching) tool
    pub fn with_glob(mut self) -> Self {
        self.enable_glob = true;
        self
    }

    /// Set the default working directory for grep tool
    pub fn with_grep_working_directory(mut self, dir: String) -> Self {
        self.grep_working_directory = Some(dir);
        self
    }

    /// Set the default working directory for glob tool
    pub fn with_glob_working_directory(mut self, dir: String) -> Self {
        self.glob_working_directory = Some(dir);
        self
    }

    /// Enable the built-in kill_shell tool
    pub fn with_kill_shell(mut self) -> Self {
        self.enable_kill_shell = true;
        self
    }

    /// Set the project root directory for path security enforcement.
    /// Write operations are restricted to this directory; sensitive paths
    /// outside it are blocked for reads.
    pub fn with_project_root(mut self, root: PathBuf) -> Self {
        self.project_root = Some(root);
        self
    }

    /// Set a shared bash session handle for conversation-level persistence
    pub fn with_bash_session(mut self, session: SharedBashSession) -> Self {
        self.bash_session = Some(session);
        self
    }

    /// Set the abort notification handle for cooperative bash cancellation
    pub fn with_bash_abort_notify(mut self, notify: Arc<tokio::sync::Notify>) -> Self {
        self.bash_abort_notify = Some(notify);
        self
    }

    /// Set a shared temp file tracker for bash output truncation cleanup
    pub fn with_bash_temp_files(mut self, files: TempFileList) -> Self {
        self.bash_temp_files = Some(files);
        self
    }

    /// Set the skill tool with embedded catalog
    pub fn with_skill_tool(mut self, tool: SkillTool) -> Self {
        self.skill_tool = Some(tool);
        self
    }

    /// Enable all built-in tools
    pub fn with_builtin_tools(mut self) -> Self {
        self.enable_web_search = true;
        self.enable_web_fetch = true;
        self.enable_bash = true;
        self.enable_read = true;
        self.enable_edit = true;
        self.enable_write = true;
        self.enable_grep = true;
        self.enable_glob = true;
        self
    }
}

/// Create an OpenAI agent with full configuration
/// Adds default reasoning: {"effort": "medium"} parameter for gpt-5 models (extended thinking support)
pub fn create_openai_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent> {
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
/// Uses openai_compat::CompletionModel which serializes content as plain strings for
/// maximum compatibility with providers that don't support structured content arrays.
fn create_custom_openai_chat_completions_agent(
    api_key: &str,
    base_url: &str,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent> {
    let http_client = create_http_client();
    let client = crate::llm::openai_compat::client(base_url, api_key, http_client)?;

    let model = crate::llm::openai_compat::CompletionModel::new(client, model_id);
    Ok(build_agent(rig::agent::AgentBuilder::new(model), config))
}

/// Create an OpenRouter agent with full configuration
/// Uses the dedicated OpenRouter provider for better compatibility
/// Adds default reasoning: {"effort": "medium"} parameter for extended thinking support
pub fn create_openrouter_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent> {
    let http_client = create_http_client();
    let client = openrouter::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(openrouter_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    let mut openrouter_config = config.clone();
    if openrouter_config.model_params.additional_params.is_none() {
        // Extended thinking (reasoning.effort) can cause "Invalid signature in thinking
        // block" errors during multi-turn tool use if the streaming provider doesn't
        // supply reasoning signatures. Only enable by default for tool-free agents.
        let has_tools = config.enable_web_search
            || config.enable_web_fetch
            || config.enable_bash
            || config.enable_read
            || config.enable_edit
            || config.enable_write
            || config.enable_grep
            || config.enable_glob
            || config.enable_kill_shell
            || config.mcp_schema_tool.is_some()
            || config.mcp_tool_use.is_some()
            || config.skill_tool.is_some();

        if !has_tools {
            openrouter_config.model_params.additional_params = Some(serde_json::json!({
                "reasoning": { "effort": "medium" }
            }));
        }
    }

    // Auto-inject modalities for image-capable models (e.g. gemini-3.1-flash-image-preview)
    if model_id.contains("image-preview") || model_id.contains("image-generation") {
        let mut params = openrouter_config
            .model_params
            .additional_params
            .unwrap_or(serde_json::json!({}));
        if let Some(obj) = params.as_object_mut() {
            obj.insert(
                "modalities".to_string(),
                serde_json::json!(["image", "text"]),
            );
        }
        openrouter_config.model_params.additional_params = Some(params);
    }

    Ok(build_agent(client.agent(model_id), &openrouter_config))
}

/// Create an Ollama agent with full configuration
pub fn create_ollama_agent(
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent> {
    let http_client = create_http_client();
    let client = ollama::Client::<reqwest::Client>::builder()
        .api_key(Nothing)
        .base_url(base_url.unwrap_or(ollama_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Create an Anthropic agent with full configuration.
///
/// The completion model itself comes from core's `create_anthropic_completion_model`
/// (shared HTTP client, default base URL, prompt caching); this wrapper applies
/// desktop's AgentConfig and fills in Anthropic's mandatory default max_tokens.
pub fn create_anthropic_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent> {
    let model =
        chatshell_agent_core::create_anthropic_completion_model(api_key, base_url, model_id)?;

    let mut anthropic_config = config.clone();
    if anthropic_config.model_params.max_tokens.is_none() {
        anthropic_config.model_params.max_tokens =
            Some(chatshell_agent_core::ANTHROPIC_DEFAULT_MAX_TOKENS as i64);
    }

    Ok(build_agent(AgentBuilder::new(model), &anthropic_config))
}

/// Create an Azure OpenAI agent with full configuration.
/// The base_url is used as the Azure endpoint.
pub fn create_azure_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent> {
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

/// Create a Google Gemini agent with full configuration
pub fn create_gemini_agent(
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent> {
    let http_client = create_http_client();
    let client = gemini::Client::<reqwest::Client>::builder()
        .api_key(api_key)
        .base_url(base_url.unwrap_or(gemini_provider::DEFAULT_BASE_URL))
        .http_client(http_client)
        .build()?;

    Ok(build_agent(client.agent(model_id), config))
}

/// Helper function to apply common configuration to any agent builder
fn build_agent(mut builder: AgentBuilder, config: &AgentConfig) -> Agent {
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

    // Check if we need to add any native tools or MCP tools
    // Note: .tool() transforms AgentBuilder into AgentBuilderSimple,
    // so we need to handle the transition carefully
    let has_tools = config.enable_web_search
        || config.enable_web_fetch
        || config.enable_bash
        || config.enable_read
        || config.enable_edit
        || config.enable_write
        || config.enable_grep
        || config.enable_glob
        || config.mcp_schema_tool.is_some()
        || config.mcp_tool_use.is_some()
        || config.skill_tool.is_some();

    if has_tools {
        return build_agent_with_tools(builder, config);
    }

    builder.build()
}

/// Build agent with native tools and/or MCP tools.
///
/// In rig-core 0.32, `AgentBuilder` uses a typestate pattern: the first `.tool()` call
/// transitions from `NoToolConfig` to `WithBuilderTools`, and subsequent `.tool()` calls
/// return `Self`. This eliminates the cascading if-blocks previously needed.
fn build_agent_with_tools(builder: AgentBuilder, config: &AgentConfig) -> Agent {
    let create_bash_tool = || -> BashTool {
        let mut tool = if let Some(ref session) = config.bash_session {
            tracing::info!("🖥️ Bash tool using shared conversation session");
            BashTool::with_session(session.clone(), config.bash_working_directory.clone())
        } else if let Some(ref dir) = config.bash_working_directory {
            tracing::info!("🖥️ Bash tool configured with working directory: {}", dir);
            BashTool::with_working_directory(dir.clone())
        } else {
            BashTool::new()
        };
        if let Some(ref notify) = config.bash_abort_notify {
            tool = tool.with_abort_notify(notify.clone());
        }
        if let Some(ref tracker) = config.bash_temp_files {
            tool = tool.with_temp_file_tracker(tracker.clone());
        }
        if let Some(ref root) = config.project_root {
            tool = tool.with_project_root(root.clone());
        }
        tool
    };

    let create_read_tool = || -> ReadTool {
        if let Some(ref root) = config.project_root {
            ReadTool::with_project_root(root.clone())
        } else {
            ReadTool::new()
        }
    };

    let create_edit_tool = || -> EditTool {
        if let Some(ref root) = config.project_root {
            EditTool::with_project_root(root.clone())
        } else {
            EditTool::new()
        }
    };

    let create_write_tool = || -> WriteTool {
        if let Some(ref root) = config.project_root {
            WriteTool::with_project_root(root.clone())
        } else {
            WriteTool::new()
        }
    };

    let create_grep_tool = || -> GrepTool {
        let tool = if let Some(ref dir) = config.grep_working_directory {
            tracing::info!("🔎 Grep tool configured with working directory: {}", dir);
            GrepTool::with_working_directory(dir.clone())
        } else {
            GrepTool::new()
        };
        if let Some(ref root) = config.project_root {
            tool.with_project_root(root.clone())
        } else {
            tool
        }
    };

    let create_glob_tool = || -> GlobTool {
        let tool = if let Some(ref dir) = config.glob_working_directory {
            tracing::info!("📂 Glob tool configured with working directory: {}", dir);
            GlobTool::with_working_directory(dir.clone())
        } else {
            GlobTool::new()
        };
        if let Some(ref root) = config.project_root {
            tool.with_project_root(root.clone())
        } else {
            tool
        }
    };

    // Create bash tool once (if enabled) so kill_shell can share its session
    let bash_tool_instance: Option<BashTool> = if config.enable_bash {
        Some(create_bash_tool())
    } else {
        None
    };

    // Transition AgentBuilder from NoToolConfig -> WithBuilderTools using the
    // highest-priority enabled tool, then chain all remaining tools.
    macro_rules! first_tool {
        ($builder:expr) => {{
            match first_added(config) {
                FirstTool::WebSearch => $builder.tool(WebSearchTool::new()),
                FirstTool::WebFetch => $builder.tool(WebFetchTool::new()),
                FirstTool::Bash => $builder.tool(bash_tool_instance.as_ref().unwrap().clone()),
                FirstTool::Read => $builder.tool(create_read_tool()),
                FirstTool::Edit => $builder.tool(create_edit_tool()),
                FirstTool::Write => $builder.tool(create_write_tool()),
                FirstTool::Grep => $builder.tool(create_grep_tool()),
                FirstTool::Glob => $builder.tool(create_glob_tool()),
                FirstTool::McpSchema => $builder.tool(config.mcp_schema_tool.clone().unwrap()),
                FirstTool::McpToolUse => $builder.tool(config.mcp_tool_use.clone().unwrap()),
                FirstTool::Skill => $builder.tool(config.skill_tool.clone().unwrap()),
            }
        }};
    }

    let first = first_added(config);
    let mut sb = first_tool!(builder);

    if config.enable_web_fetch && first != FirstTool::WebFetch {
        tracing::info!("🌐 Adding web_fetch tool to agent");
        sb = sb.tool(WebFetchTool::new());
    }
    if let Some(ref bash) = bash_tool_instance {
        if first != FirstTool::Bash {
            tracing::info!("🖥️ Adding bash tool to agent");
            sb = sb.tool(bash.clone());
        }
        if config.enable_kill_shell {
            tracing::info!("🔪 Adding kill_shell tool to agent");
            sb = sb.tool(KillShellTool::new(bash.session_handle()));
        }
    }
    if config.enable_read && first != FirstTool::Read {
        tracing::info!("📖 Adding read tool to agent");
        sb = sb.tool(create_read_tool());
    }
    if config.enable_edit && first != FirstTool::Edit {
        tracing::info!("✏️ Adding edit tool to agent");
        sb = sb.tool(create_edit_tool());
    }
    if config.enable_write && first != FirstTool::Write {
        tracing::info!("📝 Adding write tool to agent");
        sb = sb.tool(create_write_tool());
    }
    if config.enable_grep && first != FirstTool::Grep {
        tracing::info!("🔎 Adding grep tool to agent");
        sb = sb.tool(create_grep_tool());
    }
    if config.enable_glob && first != FirstTool::Glob {
        tracing::info!("📂 Adding glob tool to agent");
        sb = sb.tool(create_glob_tool());
    }
    if config.mcp_schema_tool.is_some() && first != FirstTool::McpSchema {
        tracing::info!("📋 Adding mcp_schema tool to agent");
        sb = sb.tool(config.mcp_schema_tool.clone().unwrap());
    }
    if config.mcp_tool_use.is_some() && first != FirstTool::McpToolUse {
        tracing::info!("🔌 Adding mcp_tool_use tool to agent");
        sb = sb.tool(config.mcp_tool_use.clone().unwrap());
    }
    if config.skill_tool.is_some() && first != FirstTool::Skill {
        tracing::info!("📋 Adding skill tool to agent");
        sb = sb.tool(config.skill_tool.clone().unwrap());
    }

    sb.build()
}

/// Identifies which tool was used to bootstrap the `NoToolConfig -> WithBuilderTools` transition.
#[derive(PartialEq)]
enum FirstTool {
    WebSearch,
    WebFetch,
    Bash,
    Read,
    Edit,
    Write,
    Grep,
    Glob,
    McpSchema,
    McpToolUse,
    Skill,
}

fn first_added(config: &AgentConfig) -> FirstTool {
    if config.enable_web_search {
        FirstTool::WebSearch
    } else if config.enable_web_fetch {
        FirstTool::WebFetch
    } else if config.enable_bash {
        FirstTool::Bash
    } else if config.enable_read {
        FirstTool::Read
    } else if config.enable_edit {
        FirstTool::Edit
    } else if config.enable_write {
        FirstTool::Write
    } else if config.enable_grep {
        FirstTool::Grep
    } else if config.enable_glob {
        FirstTool::Glob
    } else if config.mcp_schema_tool.is_some() {
        FirstTool::McpSchema
    } else if config.mcp_tool_use.is_some() {
        FirstTool::McpToolUse
    } else {
        FirstTool::Skill
    }
}

/// Build a rig-native agent for one of the per-provider clients
/// (cohere/deepseek/groq/...). All of these constructors are shape-identical;
/// the macro keeps one implementation.
fn create_rig_native_agent(
    provider_type: &str,
    api_key: &str,
    base_url: Option<&str>,
    model_id: &str,
    config: &AgentConfig,
) -> Result<Agent> {
    let http_client = create_http_client();
    macro_rules! native {
        ($module:ident, $provider:ident) => {{
            let client = $module::Client::<reqwest::Client>::builder()
                .api_key(api_key)
                .base_url(base_url.unwrap_or($provider::DEFAULT_BASE_URL))
                .http_client(http_client.clone())
                .build()?;
            Ok(build_agent(client.agent(model_id), config))
        }};
    }
    match provider_type {
        "cohere" => native!(cohere, cohere_provider),
        "deepseek" => native!(deepseek, deepseek_provider),
        "groq" => native!(groq, groq_provider),
        "hyperbolic" => native!(hyperbolic, hyperbolic_provider),
        "mira" => native!(mira, mira_provider),
        "mistral" => native!(mistral, mistral_provider),
        "moonshot" => native!(moonshot, moonshot_provider),
        "perplexity" => native!(perplexity, perplexity_provider),
        "together" => native!(together, together_provider),
        "xai" => native!(xai, xai_provider),
        _ => Err(anyhow::anyhow!(
            "Unknown rig-native provider: {}",
            provider_type
        )),
    }
}

/// Create a provider agent based on provider type.
///
/// Routing data (constructor family, default URL, key requirement,
/// string-content quirk) comes from the shared `provider_catalog` table in
/// `chatshell-agent-core`. `api_style` is only consulted for `custom_openai`
/// to choose between the Responses API and the Chat Completions API.
pub fn create_provider_agent(
    provider_type: &str,
    model_id: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    api_style: Option<&str>,
    config: &AgentConfig,
) -> Result<Agent> {
    let route = provider_catalog::resolve(provider_type)
        .ok_or_else(|| anyhow::anyhow!("Unknown provider: {}", provider_type))?;

    let api_key: Option<&str> = if route.key_required {
        Some(api_key.ok_or_else(|| {
            anyhow::anyhow!(
                "{} API key required",
                route.key_display.unwrap_or(provider_type)
            )
        })?)
    } else if route.local_no_key {
        Some(api_key.unwrap_or("no-key"))
    } else {
        None
    };

    match route.wire {
        provider_catalog::Wire::Responses => {
            let key = api_key.expect("responses routes require a key");
            if route.kind == Some(chatshell_agent_core::types::ProviderKind::CustomOpenAi) {
                let url = base_url.ok_or_else(|| {
                    anyhow::anyhow!("Base URL is required for custom OpenAI-compatible providers")
                })?;
                if api_style == Some("chat_completions") {
                    create_custom_openai_chat_completions_agent(key, url, model_id, config)
                } else {
                    create_openai_agent(key, Some(url), model_id, config)
                }
            } else {
                create_openai_agent(key, base_url, model_id, config)
            }
        }
        provider_catalog::Wire::OpenAiCompat => {
            let default_url = match provider_type {
                "galadriel" => galadriel_provider::DEFAULT_BASE_URL,
                "minimax" => minimax_provider::DEFAULT_BASE_URL,
                "minimax_cn" => minimax_cn_provider::DEFAULT_BASE_URL,
                _ => route
                    .default_base_url
                    .expect("catch-all routes carry a default URL"),
            };
            create_openai_compat_agent(
                api_key.expect("openai-compat routes require a key"),
                base_url.unwrap_or(default_url),
                model_id,
                config,
                provider_type,
            )
        }
        provider_catalog::Wire::Anthropic => {
            let key = api_key.expect("anthropic routes require a key");
            if provider_type == "custom_anthropic" {
                let url = base_url.ok_or_else(|| {
                    anyhow::anyhow!(
                        "Base URL is required for custom Anthropic-compatible providers"
                    )
                })?;
                create_anthropic_agent(key, Some(url), model_id, config)
            } else {
                create_anthropic_agent(key, base_url, model_id, config)
            }
        }
        provider_catalog::Wire::OpenRouter => create_openrouter_agent(
            api_key.expect("openrouter routes require a key"),
            base_url,
            model_id,
            config,
        ),
        provider_catalog::Wire::Ollama => create_ollama_agent(base_url, model_id, config),
        provider_catalog::Wire::Azure => create_azure_agent(
            api_key.expect("azure routes require a key"),
            base_url,
            model_id,
            config,
        ),
        provider_catalog::Wire::Gemini => create_gemini_agent(
            api_key.expect("gemini routes require a key"),
            base_url,
            model_id,
            config,
        ),
        provider_catalog::Wire::RigNative => create_rig_native_agent(
            provider_type,
            api_key.expect("rig-native routes require a key"),
            base_url,
            model_id,
            config,
        ),
    }
}

fn create_openai_compat_agent(
    api_key: &str,
    base_url: &str,
    model_id: &str,
    config: &AgentConfig,
    provider_type: &str,
) -> Result<Agent> {
    let http_client = create_http_client();
    let client = crate::llm::openai_compat::client(base_url, api_key, http_client)?;

    let model = crate::llm::openai_compat::CompletionModel::new(client, model_id);
    let model = if provider_catalog::is_string_content_only(provider_type) {
        model.with_string_content_only()
    } else {
        model
    };
    Ok(build_agent(rig::agent::AgentBuilder::new(model), config))
}

/// Stream chat with an agent, handling all provider types uniformly.
/// Returns the complete response after streaming.
pub async fn stream_chat_with_agent(
    agent: Agent,
    prompt: Message,
    chat_history: Vec<Message>,
    cancel_token: CancellationToken,
    callback: impl FnMut(String, StreamChunkType) -> bool + Send,
    log_prefix: &str,
) -> Result<ChatResponse> {
    agent_streaming::stream_agent(
        agent,
        prompt,
        chat_history,
        cancel_token,
        callback,
        log_prefix,
    )
    .await
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
pub fn build_assistant_message(text: &str, reasoning: Option<&str>) -> Message {
    let mut content_items: Vec<AssistantContent> = vec![];
    if let Some(r) = reasoning {
        if !r.is_empty() {
            content_items.push(AssistantContent::reasoning(r));
        }
    }
    content_items.push(AssistantContent::Text(text.to_string().into()));
    Message::Assistant {
        id: None,
        content: content_items,
    }
}

/// Build an assistant message that includes tool calls alongside optional text.
pub fn build_assistant_message_with_tool_calls(
    text: &str,
    tool_calls: &[crate::llm::ToolCallData],
    reasoning: Option<&str>,
) -> Message {
    let mut content_items: Vec<AssistantContent> = vec![];
    if let Some(r) = reasoning {
        if !r.is_empty() {
            content_items.push(AssistantContent::reasoning(r));
        }
    }
    if !text.is_empty() {
        content_items.push(AssistantContent::Text(text.to_string().into()));
    }
    for tc in tool_calls {
        let args: serde_json::Value = serde_json::from_str(&tc.tool_input)
            .unwrap_or(serde_json::Value::String(tc.tool_input.clone()));
        content_items.push(if let Some(ref call_id) = tc.call_id {
            AssistantContent::tool_call_with_call_id(&tc.id, call_id.clone(), &tc.tool_name, args)
        } else {
            AssistantContent::tool_call(&tc.id, &tc.tool_name, args)
        });
    }
    if content_items.is_empty() {
        content_items.push(AssistantContent::Text(String::new().into()));
    }
    Message::Assistant {
        id: None,
        content: content_items,
    }
}

/// Build a tool result message (sent as a User message with ToolResult content).
pub fn build_tool_result_message(
    tool_call_id: &str,
    call_id: Option<&str>,
    output: &str,
) -> Message {
    use rig::message::{ToolResultContent, UserContent};
    let content = vec![ToolResultContent::text(output)];
    Message::User {
        content: vec![if let Some(call_id) = call_id {
            UserContent::tool_result_with_call_id(
                tool_call_id,
                call_id.to_string(),
                // The executed tool name is not tracked on the streaming
                // callback path; OpenAI-style wires key replay on the ids.
                "",
                content,
            )
        } else {
            UserContent::tool_result(tool_call_id, "", content)
        }],
    }
}
