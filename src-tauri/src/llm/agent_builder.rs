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
    BashTool, EditTool, GlobTool, GrepTool, ImageQuestionResponder, KillShellTool, McpSchemaTool,
    McpToolUseTool, ReadTool, SharedBashSession, SkillTool, TempFileList, UrlByteFetcher,
    WebFetchTool, WebSearchTool, WriteTool,
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
use crate::web_search::SearchProvider;

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
    /// Search provider used by the built-in web search tool
    pub search_provider: SearchProvider,
    /// Enable built-in web fetch tool
    pub enable_web_fetch: bool,
    /// User-configured strategy for the web fetch tool (HTTP/browser tiers,
    /// Jina API). `None` = tool defaults.
    pub fetch_config: Option<crate::web_fetch::FetchConfig>,
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
    /// Host-injected vision-question seam for the read tool (one-shot
    /// vision-model call answering `read`'s `question` argument)
    pub read_image_question: Option<Arc<dyn ImageQuestionResponder>>,
    /// Whether the conversation's main model accepts image input; drives
    /// the read tool's metadata-plus-guidance fallback. `None` = unset.
    pub read_main_model_vision: Option<bool>,
    /// Host-provided raw-byte fetcher for remote read paths.
    pub read_url_fetcher: Option<Arc<dyn UrlByteFetcher>>,
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

    /// Set the search provider used by the built-in web search tool
    pub fn with_search_provider(mut self, provider: SearchProvider) -> Self {
        self.search_provider = provider;
        self
    }

    /// Enable the built-in web fetch tool
    pub fn with_web_fetch(mut self) -> Self {
        self.enable_web_fetch = true;
        self
    }

    pub fn with_fetch_config(mut self, config: crate::web_fetch::FetchConfig) -> Self {
        self.fetch_config = Some(config);
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

    /// Attach a vision-question responder to the read tool
    pub fn with_read_image_question(mut self, responder: Arc<dyn ImageQuestionResponder>) -> Self {
        self.read_image_question = Some(responder);
        self
    }

    /// Declare whether the conversation's main model accepts image input
    pub fn with_read_main_model_vision(mut self, supports: bool) -> Self {
        self.read_main_model_vision = Some(supports);
        self
    }

    /// Enable remote URL paths for the read tool.
    pub fn with_read_url_fetcher(mut self, fetcher: Arc<dyn UrlByteFetcher>) -> Self {
        self.read_url_fetcher = Some(fetcher);
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
        let mut tool = if let Some(root) = &config.project_root {
            ReadTool::with_project_root(root.clone())
        } else {
            ReadTool::new()
        };
        if let Some(responder) = &config.read_image_question {
            tool = tool.with_image_question(responder.clone());
        }
        if let Some(supports) = config.read_main_model_vision {
            tool = tool.with_main_model_vision(supports);
        }
        if let Some(fetcher) = &config.read_url_fetcher {
            tool = tool.with_url_fetcher(fetcher.clone());
        }
        tool
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

    let create_web_fetch_tool = || -> WebFetchTool {
        match &config.fetch_config {
            Some(fetch_config) => WebFetchTool::with_config(fetch_config.clone()),
            None => WebFetchTool::new(),
        }
    };

    let create_glob_tool = || -> GlobTool {
        let tool = if let Some(dir) = &config.glob_working_directory {
            tracing::info!("📂 Glob tool configured with working directory: {}", dir);
            GlobTool::with_working_directory(dir.clone())
        } else {
            GlobTool::new()
        };
        if let Some(root) = &config.project_root {
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
                FirstTool::WebSearch => {
                    $builder.tool(WebSearchTool::with_provider(config.search_provider))
                }
                FirstTool::WebFetch => $builder.tool(create_web_fetch_tool()),
                FirstTool::Bash => $builder.tool(bash_tool_instance.as_ref().unwrap().clone()),
                FirstTool::Read => $builder.tool(create_read_tool()),
                FirstTool::Write => $builder.tool(create_write_tool()),
                FirstTool::Edit => $builder.tool(create_edit_tool()),
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
        sb = sb.tool(create_web_fetch_tool());
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::time::Duration;

    use rig::completion::{
        CompletionError, CompletionModel, CompletionRequest, CompletionResponse, Prompt, Usage,
    };
    use rig::message::{
        DocumentMediaType, DocumentSourceKind, ImageMediaType, ToolResultContent, UserContent,
    };
    use rig::streaming::StreamingCompletionResponse;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;
    use crate::llm::tools::SkillCatalogEntry;
    use crate::llm::{FileData, ImageData, ToolCallData};

    // ------------------------------------------------------------------
    // Recording completion model
    // ------------------------------------------------------------------

    /// Completion model that records every request it receives and answers
    /// with a fixed text response. Observes exactly what `build_agent` put
    /// on the model call (parameters and tool definitions) without any
    /// provider or network.
    #[derive(Clone)]
    struct RecordingModel {
        requests: Arc<Mutex<Vec<CompletionRequest>>>,
    }

    impl RecordingModel {
        fn new() -> Self {
            Self {
                requests: Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    impl CompletionModel for RecordingModel {
        async fn completion(
            &self,
            request: CompletionRequest,
        ) -> Result<CompletionResponse, CompletionError> {
            self.requests.lock().unwrap().push(request);
            Ok(CompletionResponse::new(
                vec![AssistantContent::Text("ok".to_string().into())],
                Usage::new(),
                "recording",
            ))
        }

        async fn stream(
            &self,
            _request: CompletionRequest,
        ) -> Result<StreamingCompletionResponse, CompletionError> {
            Err(CompletionError::ProviderError(
                "RecordingModel does not stream".to_string(),
            ))
        }
    }

    /// Build an agent over a recording model, run one prompt, and return the
    /// completion request the model received.
    async fn recorded_request(config: &AgentConfig) -> CompletionRequest {
        let model = RecordingModel::new();
        let agent = build_agent(AgentBuilder::new(model.clone()), config);
        agent
            .prompt("record")
            .await
            .expect("prompt against recording model should succeed");
        let requests = model.requests.lock().unwrap().clone();
        assert_eq!(requests.len(), 1, "expected exactly one model call");
        requests.into_iter().next().unwrap()
    }

    fn tool_names(request: &CompletionRequest) -> Vec<&str> {
        request.tools.iter().map(|t| t.name.as_str()).collect()
    }

    fn empty_mcp_tool_use() -> McpToolUseTool {
        McpToolUseTool::new(
            Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            HashMap::new(),
        )
    }

    fn empty_schema_tool() -> McpSchemaTool {
        McpSchemaTool::new(Vec::new(), "unused-schema-dir".to_string())
    }

    fn empty_skill_tool() -> SkillTool {
        SkillTool::new(Vec::new())
    }

    fn full_tool_config() -> AgentConfig {
        AgentConfig::new()
            .with_web_search()
            .with_web_fetch()
            .with_bash()
            .with_kill_shell()
            .with_read()
            .with_edit()
            .with_write()
            .with_grep()
            .with_glob()
            .with_mcp_schema_tool(empty_schema_tool())
            .with_mcp_tool_use(empty_mcp_tool_use())
            .with_skill_tool(empty_skill_tool())
    }

    // ------------------------------------------------------------------
    // AgentConfig construction
    // ------------------------------------------------------------------

    #[test]
    fn agent_config_default_is_blank() {
        let config = AgentConfig::new();
        assert!(config.system_prompt.is_none());
        assert_eq!(config.model_params.temperature, None);
        assert_eq!(config.model_params.max_tokens, None);
        assert!(config.model_params.additional_params.is_none());
        assert!(!config.enable_web_search);
        assert!(!config.enable_web_fetch);
        assert!(!config.enable_bash);
        assert!(!config.enable_read);
        assert!(!config.enable_edit);
        assert!(!config.enable_write);
        assert!(!config.enable_grep);
        assert!(!config.enable_glob);
        assert!(!config.enable_kill_shell);
        assert!(config.mcp_schema_tool.is_none());
        assert!(config.mcp_tool_use.is_none());
        assert!(config.skill_tool.is_none());
        assert!(config.project_root.is_none());
        assert!(matches!(config.search_provider, SearchProvider::DuckDuckGo));
    }

    #[test]
    fn agent_config_withers_set_their_fields() {
        let config = AgentConfig::new()
            .with_system_prompt("sys")
            .with_temperature(0.4)
            .with_max_tokens(512)
            .with_additional_params(json!({"k": "v"}))
            .with_search_provider(SearchProvider::Baidu)
            .with_bash_working_directory("/bash-dir".to_string())
            .with_grep_working_directory("/grep-dir".to_string())
            .with_glob_working_directory("/glob-dir".to_string())
            .with_read_main_model_vision(false)
            .with_project_root(PathBuf::from("/project"));
        assert_eq!(config.system_prompt.as_deref(), Some("sys"));
        assert_eq!(config.model_params.temperature, Some(0.4));
        assert_eq!(config.model_params.max_tokens, Some(512));
        assert_eq!(
            config.model_params.additional_params,
            Some(json!({"k": "v"}))
        );
        assert!(matches!(config.search_provider, SearchProvider::Baidu));
        assert_eq!(config.bash_working_directory.as_deref(), Some("/bash-dir"));
        assert_eq!(config.grep_working_directory.as_deref(), Some("/grep-dir"));
        assert_eq!(config.glob_working_directory.as_deref(), Some("/glob-dir"));
        assert_eq!(config.read_main_model_vision, Some(false));
        assert_eq!(config.project_root, Some(PathBuf::from("/project")));
    }

    #[test]
    fn tool_enable_withers_flip_flags() {
        let config = AgentConfig::new()
            .with_web_search()
            .with_web_fetch()
            .with_bash()
            .with_read()
            .with_edit()
            .with_write()
            .with_grep()
            .with_glob()
            .with_kill_shell();
        assert!(config.enable_web_search);
        assert!(config.enable_web_fetch);
        assert!(config.enable_bash);
        assert!(config.enable_read);
        assert!(config.enable_edit);
        assert!(config.enable_write);
        assert!(config.enable_grep);
        assert!(config.enable_glob);
        assert!(config.enable_kill_shell);
    }

    #[test]
    fn with_builtin_tools_enables_core_tools_but_not_kill_shell() {
        let config = AgentConfig::new().with_builtin_tools();
        assert!(config.enable_web_search);
        assert!(config.enable_web_fetch);
        assert!(config.enable_bash);
        assert!(config.enable_read);
        assert!(config.enable_edit);
        assert!(config.enable_write);
        assert!(config.enable_grep);
        assert!(config.enable_glob);
        assert!(
            !config.enable_kill_shell,
            "kill_shell is a bash companion and must not be enabled by the bulk setter"
        );
    }

    #[test]
    fn mcp_and_skill_withers_attach_tools() {
        let config = AgentConfig::new()
            .with_mcp_schema_tool(empty_schema_tool())
            .with_mcp_tool_use(empty_mcp_tool_use())
            .with_skill_tool(SkillTool::new(vec![SkillCatalogEntry {
                name: "probe".to_string(),
                description: Some("probe skill".to_string()),
                path: "/skills/probe/SKILL.md".to_string(),
            }]));
        assert!(config.mcp_schema_tool.is_some());
        assert!(config.mcp_tool_use.is_some());
        assert!(config.skill_tool.is_some());
    }

    #[test]
    fn with_model_params_replaces_the_whole_set() {
        let params = ModelParameters {
            temperature: Some(0.9),
            max_tokens: Some(77),
            ..ModelParameters::default()
        };
        let config = AgentConfig::new()
            .with_temperature(0.1)
            .with_max_tokens(9)
            .with_model_params(params);
        assert_eq!(config.model_params.temperature, Some(0.9));
        assert_eq!(config.model_params.max_tokens, Some(77));
    }

    // ------------------------------------------------------------------
    // first_added priority
    // ------------------------------------------------------------------

    #[test]
    fn first_added_picks_the_highest_priority_tool() {
        assert!(
            first_added(&AgentConfig::new()) == FirstTool::Skill,
            "empty config falls back to Skill"
        );
        let config = AgentConfig::new()
            .with_web_fetch()
            .with_bash()
            .with_read()
            .with_glob()
            .with_skill_tool(empty_skill_tool());
        assert!(first_added(&config) == FirstTool::WebFetch);

        let config = AgentConfig::new().with_bash().with_read().with_glob();
        assert!(first_added(&config) == FirstTool::Bash);

        let config = AgentConfig::new().with_read().with_glob();
        assert!(first_added(&config) == FirstTool::Read);

        let config = AgentConfig::new().with_glob();
        assert!(first_added(&config) == FirstTool::Glob);
    }

    #[test]
    fn first_added_ranks_native_tools_above_mcp_and_skill() {
        let config = AgentConfig::new()
            .with_mcp_schema_tool(empty_schema_tool())
            .with_mcp_tool_use(empty_mcp_tool_use())
            .with_skill_tool(empty_skill_tool());
        assert!(first_added(&config) == FirstTool::McpSchema);

        let config = AgentConfig::new()
            .with_mcp_tool_use(empty_mcp_tool_use())
            .with_skill_tool(empty_skill_tool());
        assert!(first_added(&config) == FirstTool::McpToolUse);

        let config = AgentConfig::new().with_skill_tool(empty_skill_tool());
        assert!(first_added(&config) == FirstTool::Skill);
    }

    // ------------------------------------------------------------------
    // build_agent parameter application
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn build_agent_applies_all_configured_params() {
        let config = AgentConfig::new()
            .with_system_prompt("You are a probe.")
            .with_temperature(0.25)
            .with_max_tokens(4242)
            .with_additional_params(json!({"foo": "bar"}));
        let request = recorded_request(&config).await;
        // rig 0.42 runners carry the preamble as a leading system message,
        // not as the legacy CompletionRequest.preamble field.
        match request.chat_history.first() {
            Some(Message::System { content }) => {
                assert_eq!(content, "You are a probe.")
            }
            other => panic!("preamble should lead the history, got {other:?}"),
        }
        assert_eq!(request.temperature, Some(0.25));
        assert_eq!(request.max_tokens, Some(4242));
        assert_eq!(request.additional_params, Some(json!({"foo": "bar"})));
        assert!(request.tools.is_empty());
    }

    #[tokio::test]
    async fn build_agent_leaves_unset_params_none() {
        let request = recorded_request(&AgentConfig::new()).await;
        assert!(!matches!(
            request.chat_history.first(),
            Some(Message::System { .. })
        ));
        assert_eq!(request.temperature, None);
        assert_eq!(request.max_tokens, None);
        assert_eq!(request.additional_params, None);
        assert!(request.tools.is_empty());
    }

    #[tokio::test]
    async fn build_agent_applies_params_partially() {
        let config = AgentConfig::new().with_max_tokens(128);
        let request = recorded_request(&config).await;
        assert_eq!(request.max_tokens, Some(128));
        assert!(!matches!(
            request.chat_history.first(),
            Some(Message::System { .. })
        ));
        assert_eq!(request.temperature, None);
        assert_eq!(request.additional_params, None);
    }

    // ------------------------------------------------------------------
    // Tool assembly
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn full_tool_stack_registers_in_priority_order() {
        let request = recorded_request(&full_tool_config()).await;
        assert_eq!(
            tool_names(&request),
            vec![
                "web_search",
                "web_fetch",
                "bash",
                "kill_shell",
                "read",
                "edit",
                "write",
                "grep",
                "glob",
                "mcp_schema",
                "mcp_tool_use",
                "skill",
            ]
        );
    }

    #[tokio::test]
    async fn every_tool_is_registered_exactly_once() {
        let request = recorded_request(&full_tool_config()).await;
        for name in tool_names(&request) {
            let count = tool_names(&request).iter().filter(|n| **n == name).count();
            assert_eq!(count, 1, "tool {name} must not be registered twice");
        }
    }

    #[tokio::test]
    async fn subset_keeps_priority_order_without_gaps() {
        let config = AgentConfig::new()
            .with_read()
            .with_glob()
            .with_skill_tool(empty_skill_tool());
        let request = recorded_request(&config).await;
        assert_eq!(tool_names(&request), vec!["read", "glob", "skill"]);
    }

    #[tokio::test]
    async fn web_tools_register_in_priority_order() {
        let config = AgentConfig::new().with_web_fetch().with_web_search();
        let request = recorded_request(&config).await;
        assert_eq!(tool_names(&request), vec!["web_search", "web_fetch"]);
    }

    #[tokio::test]
    async fn mcp_tool_use_alone_is_a_valid_tool_set() {
        let config = AgentConfig::new().with_mcp_tool_use(empty_mcp_tool_use());
        let request = recorded_request(&config).await;
        assert_eq!(tool_names(&request), vec!["mcp_tool_use"]);
    }

    #[tokio::test]
    async fn mcp_schema_alone_is_a_valid_tool_set() {
        let config = AgentConfig::new().with_mcp_schema_tool(empty_schema_tool());
        let request = recorded_request(&config).await;
        assert_eq!(tool_names(&request), vec!["mcp_schema"]);
    }

    #[tokio::test]
    async fn skill_tool_alone_bootstraps_the_tool_state() {
        let config = AgentConfig::new().with_skill_tool(empty_skill_tool());
        let request = recorded_request(&config).await;
        assert_eq!(tool_names(&request), vec!["skill"]);
    }

    #[tokio::test]
    async fn kill_shell_without_bash_registers_no_tools() {
        let config = AgentConfig::new().with_kill_shell();
        let request = recorded_request(&config).await;
        assert!(
            request.tools.is_empty(),
            "kill_shell is only added alongside bash"
        );
    }

    #[tokio::test]
    async fn kill_shell_with_bash_sits_right_after_bash() {
        let config = AgentConfig::new().with_bash().with_kill_shell();
        let request = recorded_request(&config).await;
        assert_eq!(tool_names(&request), vec!["bash", "kill_shell"]);
    }

    #[tokio::test]
    async fn kill_shell_is_dropped_when_bash_is_disabled() {
        let config = AgentConfig::new().with_kill_shell().with_read();
        let request = recorded_request(&config).await;
        assert_eq!(tool_names(&request), vec!["read"]);
    }

    #[tokio::test]
    async fn bash_working_directory_lands_in_the_tool_description() {
        let config = AgentConfig::new()
            .with_bash()
            .with_bash_working_directory("/probe/root".to_string());
        let request = recorded_request(&config).await;
        let bash = request
            .tools
            .iter()
            .find(|t| t.name == "bash")
            .expect("bash tool should be registered");
        assert!(
            bash.description
                .contains("The session starts in: /probe/root."),
            "bash description should carry the working directory"
        );
    }

    #[tokio::test]
    async fn bash_description_has_no_cwd_note_by_default() {
        let request = recorded_request(&full_tool_config()).await;
        let bash = request
            .tools
            .iter()
            .find(|t| t.name == "bash")
            .expect("bash tool should be registered");
        assert!(!bash.description.contains("The session starts in"));
    }

    #[tokio::test]
    async fn grep_working_directory_lands_in_the_parameter_schema() {
        let config = AgentConfig::new()
            .with_grep()
            .with_grep_working_directory("/probe/data".to_string());
        let request = recorded_request(&config).await;
        let grep = request
            .tools
            .iter()
            .find(|t| t.name == "grep")
            .expect("grep tool should be registered");
        let description = grep.parameters["properties"]["path"]["description"]
            .as_str()
            .expect("grep path parameter should carry a description");
        assert!(
            description.contains("defaults to: /probe/data"),
            "unexpected grep path description: {description}"
        );
    }

    #[tokio::test]
    async fn grep_defaults_to_home_directory_without_config() {
        let request = recorded_request(&full_tool_config()).await;
        let grep = request
            .tools
            .iter()
            .find(|t| t.name == "grep")
            .expect("grep tool should be registered");
        let description = grep.parameters["properties"]["path"]["description"]
            .as_str()
            .expect("grep path parameter should carry a description");
        assert!(description.contains("defaults to home directory"));
    }

    #[tokio::test]
    async fn glob_working_directory_lands_in_the_parameter_schema() {
        let config = AgentConfig::new()
            .with_glob()
            .with_glob_working_directory("/probe/tree".to_string());
        let request = recorded_request(&config).await;
        let glob = request
            .tools
            .iter()
            .find(|t| t.name == "glob")
            .expect("glob tool should be registered");
        let description = glob.parameters["properties"]["path"]["description"]
            .as_str()
            .expect("glob path parameter should carry a description");
        assert!(
            description.contains("defaults to: /probe/tree"),
            "unexpected glob path description: {description}"
        );
    }

    // ------------------------------------------------------------------
    // Message builders
    // ------------------------------------------------------------------

    #[test]
    fn build_user_message_wraps_text_in_a_user_message() {
        let Message::User { content } = build_user_message("hello", &[], &[]) else {
            panic!("expected a user message");
        };
        assert_eq!(content.len(), 1);
        let UserContent::Text(text) = &content[0] else {
            panic!("expected plain text content");
        };
        assert_eq!(text.text, "hello");
    }

    #[test]
    fn build_user_message_orders_text_document_then_image() {
        let images = vec![ImageData {
            base64: "cHJvYmU=".to_string(),
            media_type: "image/png".to_string(),
        }];
        let files = vec![FileData {
            name: "notes.md".to_string(),
            content: "probe body".to_string(),
            media_type: "text/markdown".to_string(),
            bytes: None,
        }];
        let Message::User { content } = build_user_message("see attachment", &images, &files)
        else {
            panic!("expected a user message");
        };
        assert_eq!(content.len(), 3);
        assert!(matches!(content[0], UserContent::Text(_)));

        let UserContent::Document(document) = &content[1] else {
            panic!("file content should come before images");
        };
        let DocumentSourceKind::String(text) = &document.data else {
            panic!("file content should ride as a plain string");
        };
        assert!(text.contains("<filename>notes.md</filename>"));
        assert!(text.contains("probe body"));
        assert!(matches!(
            document.media_type,
            Some(DocumentMediaType::MARKDOWN)
        ));

        let UserContent::Image(image) = &content[2] else {
            panic!("expected the image to come last");
        };
        let DocumentSourceKind::Base64(data) = &image.data else {
            panic!("image should ride as base64");
        };
        assert_eq!(data, "cHJvYmU=");
        assert!(matches!(image.media_type, Some(ImageMediaType::PNG)));
    }

    #[test]
    fn build_assistant_message_without_reasoning_is_text_only() {
        let Message::Assistant { id, content } = build_assistant_message("hi", None) else {
            panic!("expected an assistant message");
        };
        assert!(id.is_none());
        assert_eq!(content.len(), 1);
        assert!(matches!(&content[0], AssistantContent::Text(t) if t.text == "hi"));
    }

    #[test]
    fn build_assistant_message_prefixes_reasoning_before_text() {
        let Message::Assistant { content, .. } = build_assistant_message("answer", Some("because"))
        else {
            panic!("expected an assistant message");
        };
        assert_eq!(content.len(), 2);
        assert!(matches!(content[0], AssistantContent::Reasoning(_)));
        assert!(matches!(&content[1], AssistantContent::Text(t) if t.text == "answer"));
    }

    #[test]
    fn build_assistant_message_skips_empty_reasoning() {
        let Message::Assistant { content, .. } = build_assistant_message("hi", Some("")) else {
            panic!("expected an assistant message");
        };
        assert_eq!(content.len(), 1);
        assert!(matches!(&content[0], AssistantContent::Text(t) if t.text == "hi"));
    }

    #[test]
    fn tool_calls_parse_json_arguments_and_map_call_id() {
        let tool_calls = vec![ToolCallData {
            id: "tc_1".to_string(),
            call_id: Some("call_9".to_string()),
            tool_name: "web_search".to_string(),
            tool_input: r#"{"query": "rust"}"#.to_string(),
            tool_output: None,
        }];
        let Message::Assistant { content, .. } =
            build_assistant_message_with_tool_calls("answer", &tool_calls, Some("thinking"))
        else {
            panic!("expected an assistant message");
        };
        assert_eq!(content.len(), 3);
        assert!(matches!(content[0], AssistantContent::Reasoning(_)));
        assert!(matches!(&content[1], AssistantContent::Text(t) if t.text == "answer"));

        let AssistantContent::ToolCall(call) = &content[2] else {
            panic!("expected a tool call content item");
        };
        assert_eq!(call.function.name, "web_search");
        assert_eq!(call.function.arguments, json!({"query": "rust"}));
        let provider = call
            .provider
            .as_ref()
            .expect("call_id should become the provider handle");
        assert_eq!(provider.call_id, "call_9");
        assert_eq!(provider.item_id.as_deref(), Some("tc_1"));
    }

    #[test]
    fn tool_call_without_call_id_uses_the_tool_call_id_as_handle() {
        let tool_calls = vec![ToolCallData {
            id: "tc_7".to_string(),
            call_id: None,
            tool_name: "bash".to_string(),
            tool_input: "{}".to_string(),
            tool_output: None,
        }];
        let Message::Assistant { content, .. } =
            build_assistant_message_with_tool_calls("", &tool_calls, None)
        else {
            panic!("expected an assistant message");
        };
        assert_eq!(content.len(), 1, "empty text must not produce a text item");
        let AssistantContent::ToolCall(call) = &content[0] else {
            panic!("expected a tool call content item");
        };
        let provider = call
            .provider
            .as_ref()
            .expect("from_wire should derive the handle from the id");
        assert_eq!(provider.call_id, "tc_7");
        assert_eq!(provider.item_id, None);
    }

    #[test]
    fn invalid_tool_call_json_falls_back_to_a_string_argument() {
        let tool_calls = vec![ToolCallData {
            id: "tc_2".to_string(),
            call_id: None,
            tool_name: "bash".to_string(),
            tool_input: "not json".to_string(),
            tool_output: None,
        }];
        let Message::Assistant { content, .. } =
            build_assistant_message_with_tool_calls("", &tool_calls, None)
        else {
            panic!("expected an assistant message");
        };
        let AssistantContent::ToolCall(call) = &content[0] else {
            panic!("expected a tool call content item");
        };
        assert_eq!(call.function.arguments, json!("not json"));
    }

    #[test]
    fn all_empty_tool_call_message_falls_back_to_blank_text() {
        let Message::Assistant { content, .. } =
            build_assistant_message_with_tool_calls("", &[], None)
        else {
            panic!("expected an assistant message");
        };
        assert_eq!(content.len(), 1);
        assert!(matches!(&content[0], AssistantContent::Text(t) if t.text.is_empty()));
    }

    #[test]
    fn tool_result_with_call_id_echoes_the_provider_handle() {
        let Message::User { content } =
            build_tool_result_message("tc_1", Some("call_9"), "result text")
        else {
            panic!("expected a user message");
        };
        assert_eq!(content.len(), 1);
        let UserContent::ToolResult(result) = &content[0] else {
            panic!("expected tool result content");
        };
        let provider = result
            .provider
            .as_ref()
            .expect("call_id should become the provider handle");
        assert_eq!(provider.call_id, "call_9");
        assert_eq!(provider.item_id.as_deref(), Some("tc_1"));
        assert_eq!(result.call.as_str(), "call_9");
        assert_eq!(result.name, "");
        assert_eq!(result.content.len(), 1);
        assert!(
            matches!(&result.content[0], ToolResultContent::Text(t) if t.text == "result text")
        );
    }

    #[test]
    fn tool_result_without_call_id_keys_on_the_tool_call_id() {
        let Message::User { content } = build_tool_result_message("tc_3", None, "done") else {
            panic!("expected a user message");
        };
        let UserContent::ToolResult(result) = &content[0] else {
            panic!("expected tool result content");
        };
        assert_eq!(result.provider, None);
        assert_eq!(result.call.as_str(), "tc_3");
    }

    #[test]
    fn tool_result_with_empty_call_id_is_treated_as_absent() {
        let Message::User { content } = build_tool_result_message("tc_4", Some(""), "done") else {
            panic!("expected a user message");
        };
        let UserContent::ToolResult(result) = &content[0] else {
            panic!("expected tool result content");
        };
        assert_eq!(
            result.provider, None,
            "an empty call_id must not become a provider handle"
        );
        assert!(!result.call.as_str().is_empty());
    }

    // ------------------------------------------------------------------
    // Provider routing errors
    // ------------------------------------------------------------------

    #[test]
    fn create_provider_agent_rejects_unknown_providers() {
        let error = create_provider_agent(
            "does-not-exist",
            "model",
            Some("key"),
            None,
            None,
            &AgentConfig::new(),
        )
        .err()
        .expect("unknown provider should fail");
        assert!(
            error
                .to_string()
                .contains("Unknown provider: does-not-exist")
        );
    }

    #[test]
    fn create_provider_agent_requires_keys_with_display_names() {
        let error =
            create_provider_agent("openai", "gpt-4o", None, None, None, &AgentConfig::new())
                .err()
                .expect("openai without a key should fail");
        assert!(error.to_string().contains("OpenAI API key required"));

        let error = create_provider_agent("azure", "deploy", None, None, None, &AgentConfig::new())
            .err()
            .expect("azure without a key should fail");
        assert!(error.to_string().contains("Azure OpenAI API key required"));
    }

    #[test]
    fn catch_all_providers_fall_back_to_the_raw_type_in_key_errors() {
        let error = create_provider_agent("zhipu", "glm-4", None, None, None, &AgentConfig::new())
            .err()
            .expect("catch-all provider without a key should fail");
        assert!(error.to_string().contains("zhipu API key required"));
    }

    #[test]
    fn custom_openai_requires_a_base_url() {
        let error = create_provider_agent(
            "custom_openai",
            "model",
            Some("key"),
            None,
            None,
            &AgentConfig::new(),
        )
        .err()
        .expect("custom_openai without a base URL should fail");
        assert!(
            error
                .to_string()
                .contains("Base URL is required for custom OpenAI-compatible providers")
        );
    }

    #[test]
    fn custom_anthropic_requires_a_base_url() {
        let error = create_provider_agent(
            "custom_anthropic",
            "model",
            Some("key"),
            None,
            None,
            &AgentConfig::new(),
        )
        .err()
        .expect("custom_anthropic without a base URL should fail");
        assert!(
            error
                .to_string()
                .contains("Base URL is required for custom Anthropic-compatible providers")
        );
    }

    #[test]
    fn azure_requires_an_endpoint_url() {
        let error = create_provider_agent(
            "azure",
            "deployment",
            Some("key"),
            None,
            None,
            &AgentConfig::new(),
        )
        .err()
        .expect("azure without an endpoint should fail");
        assert!(
            error
                .to_string()
                .contains("Azure OpenAI requires an endpoint URL")
        );
    }

    #[test]
    fn local_providers_build_without_a_key() {
        assert!(
            create_provider_agent("ollama", "llama3", None, None, None, &AgentConfig::new())
                .is_ok()
        );
        assert!(
            create_provider_agent(
                "lmstudio",
                "local-model",
                None,
                None,
                None,
                &AgentConfig::new()
            )
            .is_ok()
        );
    }

    #[test]
    fn keyed_providers_build_offline_with_a_dummy_key() {
        for provider in [
            "openai",
            "anthropic",
            "openrouter",
            "gemini",
            "cohere",
            "galadriel",
            "minimax",
            "zhipu",
        ] {
            let agent = create_provider_agent(
                provider,
                "probe-model",
                Some("dummy-key"),
                None,
                None,
                &AgentConfig::new(),
            );
            assert!(agent.is_ok(), "{provider} should build without network");
        }
    }

    #[test]
    fn create_rig_native_agent_rejects_unknown_providers() {
        let error = create_rig_native_agent("nope", "key", None, "model", &AgentConfig::new())
            .err()
            .expect("unknown rig-native provider should fail");
        assert!(
            error
                .to_string()
                .contains("Unknown rig-native provider: nope")
        );
    }

    // ------------------------------------------------------------------
    // Provider presets (captured on a loopback HTTP server)
    // ------------------------------------------------------------------

    struct CapturedRequest {
        #[allow(dead_code)]
        method: String,
        path: String,
        body: String,
    }

    fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    /// Serve exactly one HTTP request on a loopback port, capture it and
    /// reply with `response_body`. Nothing leaves the machine.
    async fn serve_one_request(
        response_body: &'static str,
    ) -> (String, Arc<Mutex<Option<CapturedRequest>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let captured = Arc::new(Mutex::new(None));
        let sink = captured.clone();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut raw = Vec::new();
            let mut chunk = [0u8; 8192];
            let header_end = loop {
                let n = socket.read(&mut chunk).await.unwrap();
                if n == 0 {
                    break 0;
                }
                raw.extend_from_slice(&chunk[..n]);
                if let Some(pos) = find_subsequence(&raw, b"\r\n\r\n") {
                    break pos + 4;
                }
            };
            let head = String::from_utf8_lossy(&raw[..header_end]).to_string();
            let content_length: usize = head
                .lines()
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
                .and_then(|(_, v)| v.trim().parse().ok())
                .unwrap_or(0);
            while raw.len() < header_end + content_length {
                match socket.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => raw.extend_from_slice(&chunk[..n]),
                }
            }
            let mut parts = head.lines().next().unwrap_or_default().split_whitespace();
            let method = parts.next().unwrap_or_default().to_string();
            let path = parts.next().unwrap_or_default().to_string();
            *sink.lock().unwrap() = Some(CapturedRequest {
                method,
                path,
                body: String::from_utf8_lossy(&raw[header_end..]).to_string(),
            });
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
                 Connection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        (format!("http://{address}"), captured)
    }

    fn captured_path(captured: &Arc<Mutex<Option<CapturedRequest>>>) -> String {
        captured
            .lock()
            .unwrap()
            .as_ref()
            .expect("loopback server should have captured a request")
            .path
            .clone()
    }

    fn captured_json(captured: &Arc<Mutex<Option<CapturedRequest>>>) -> serde_json::Value {
        let body = captured
            .lock()
            .unwrap()
            .as_ref()
            .expect("loopback server should have captured a request")
            .body
            .clone();
        serde_json::from_str(&body).expect("captured request body should be JSON")
    }

    /// Fire one prompt at an agent and ignore the outcome. The assertions
    /// target the wire request the loopback server captured, which is sent
    /// before any response parsing happens.
    async fn fire_prompt(agent: &Agent) {
        let _ = tokio::time::timeout(Duration::from_secs(30), agent.prompt("probe")).await;
    }

    const OPENAI_RESPONSES_BODY: &str = r#"{
        "id": "resp_probe", "object": "response", "created_at": 0,
        "status": "completed", "model": "probe",
        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
        "output": [{
            "type": "message", "id": "msg_probe", "status": "completed",
            "role": "assistant",
            "content": [{"type": "output_text", "annotations": [], "text": "ok"}]
        }],
        "tools": []
    }"#;

    const CHAT_COMPLETIONS_BODY: &str = r#"{
        "id": "cc_probe", "object": "chat.completion", "created": 0, "model": "probe",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "ok"},
            "finish_reason": "stop"
        }]
    }"#;

    const ANTHROPIC_MESSAGES_BODY: &str = r#"{
        "id": "msg_probe", "type": "message", "role": "assistant", "model": "probe",
        "content": [{"type": "text", "text": "ok"}],
        "stop_reason": "end_turn", "stop_sequence": null,
        "usage": {"input_tokens": 1, "output_tokens": 1}
    }"#;

    #[tokio::test]
    async fn openai_gpt5_models_get_default_reasoning_effort() {
        let (base_url, captured) = serve_one_request(OPENAI_RESPONSES_BODY).await;
        let agent = create_openai_agent(
            "probe-key",
            Some(&base_url),
            "gpt-5-mini",
            &AgentConfig::new(),
        )
        .expect("openai agent should build");
        fire_prompt(&agent).await;
        assert!(
            captured_path(&captured).ends_with("/responses"),
            "openai should use the Responses API"
        );
        let body = captured_json(&captured);
        assert_eq!(body["model"], json!("gpt-5-mini"));
        let reasoning = body
            .get("reasoning")
            .expect("gpt-5 models should get a default reasoning effort");
        assert_eq!(reasoning["effort"], json!("medium"));
    }

    #[tokio::test]
    async fn openai_non_gpt5_models_get_no_default_reasoning() {
        let (base_url, captured) = serve_one_request(OPENAI_RESPONSES_BODY).await;
        let agent = create_openai_agent(
            "probe-key",
            Some(&base_url),
            "gpt-4o-mini",
            &AgentConfig::new(),
        )
        .expect("openai agent should build");
        fire_prompt(&agent).await;
        let body = captured_json(&captured);
        assert!(
            body.get("reasoning").is_none(),
            "the reasoning default is gpt-5 only"
        );
    }

    #[tokio::test]
    async fn openai_user_params_are_not_replaced_on_gpt5() {
        let (base_url, captured) = serve_one_request(OPENAI_RESPONSES_BODY).await;
        let config =
            AgentConfig::new().with_additional_params(json!({"reasoning": {"effort": "high"}}));
        let agent = create_openai_agent("probe-key", Some(&base_url), "gpt-5", &config)
            .expect("openai agent should build");
        fire_prompt(&agent).await;
        let body = captured_json(&captured);
        assert_eq!(
            body["reasoning"]["effort"],
            json!("high"),
            "user-set reasoning must win over the medium default"
        );
    }

    #[tokio::test]
    async fn openrouter_tool_free_agent_gets_reasoning_default() {
        let (base_url, captured) = serve_one_request(CHAT_COMPLETIONS_BODY).await;
        let agent = create_openrouter_agent(
            "probe-key",
            Some(&base_url),
            "anthropic/claude-4-sonnet",
            &AgentConfig::new(),
        )
        .expect("openrouter agent should build");
        fire_prompt(&agent).await;
        assert!(
            captured_path(&captured).ends_with("/chat/completions"),
            "openrouter should use the Chat Completions API"
        );
        let body = captured_json(&captured);
        let reasoning = body
            .get("reasoning")
            .expect("tool-free openrouter agents get a default reasoning effort");
        assert_eq!(reasoning["effort"], json!("medium"));
    }

    #[tokio::test]
    async fn openrouter_agent_with_tools_skips_reasoning_default() {
        let (base_url, captured) = serve_one_request(CHAT_COMPLETIONS_BODY).await;
        let config = AgentConfig::new().with_read();
        let agent = create_openrouter_agent(
            "probe-key",
            Some(&base_url),
            "anthropic/claude-4-sonnet",
            &config,
        )
        .expect("openrouter agent should build");
        fire_prompt(&agent).await;
        let body = captured_json(&captured);
        assert!(
            body.get("reasoning").is_none(),
            "tool-carrying agents skip the default reasoning effort"
        );
    }

    #[tokio::test]
    async fn openrouter_user_params_are_never_overridden() {
        let (base_url, captured) = serve_one_request(CHAT_COMPLETIONS_BODY).await;
        let config = AgentConfig::new().with_additional_params(json!({"top_k": 8}));
        let agent = create_openrouter_agent(
            "probe-key",
            Some(&base_url),
            "anthropic/claude-4-sonnet",
            &config,
        )
        .expect("openrouter agent should build");
        fire_prompt(&agent).await;
        let body = captured_json(&captured);
        assert_eq!(body["top_k"], json!(8));
        assert!(body.get("reasoning").is_none());
    }

    #[tokio::test]
    async fn openrouter_image_models_get_modalities_plus_reasoning() {
        let (base_url, captured) = serve_one_request(CHAT_COMPLETIONS_BODY).await;
        let agent = create_openrouter_agent(
            "probe-key",
            Some(&base_url),
            "google/gemini-2.5-flash-image-preview",
            &AgentConfig::new(),
        )
        .expect("openrouter agent should build");
        fire_prompt(&agent).await;
        let body = captured_json(&captured);
        assert_eq!(body["modalities"], json!(["image", "text"]));
        assert_eq!(body["reasoning"]["effort"], json!("medium"));
    }

    #[tokio::test]
    async fn openrouter_image_models_merge_modalities_into_user_params() {
        let (base_url, captured) = serve_one_request(CHAT_COMPLETIONS_BODY).await;
        let config = AgentConfig::new().with_additional_params(json!({"top_k": 8}));
        let agent = create_openrouter_agent(
            "probe-key",
            Some(&base_url),
            "acme/writer-image-generation",
            &config,
        )
        .expect("openrouter agent should build");
        fire_prompt(&agent).await;
        let body = captured_json(&captured);
        assert_eq!(body["modalities"], json!(["image", "text"]));
        assert_eq!(body["top_k"], json!(8));
        assert!(
            body.get("reasoning").is_none(),
            "user-set params suppress the reasoning default"
        );
    }

    #[tokio::test]
    async fn anthropic_agent_fills_the_mandatory_max_tokens() {
        let (base_url, captured) = serve_one_request(ANTHROPIC_MESSAGES_BODY).await;
        let agent = create_anthropic_agent(
            "probe-key",
            Some(&base_url),
            "claude-sonnet-4-5",
            &AgentConfig::new(),
        )
        .expect("anthropic agent should build");
        fire_prompt(&agent).await;
        assert!(
            captured_path(&captured).ends_with("/v1/messages"),
            "anthropic should use the Messages API"
        );
        let body = captured_json(&captured);
        assert_eq!(body["max_tokens"], json!(8192));
    }

    #[tokio::test]
    async fn anthropic_agent_preserves_user_max_tokens() {
        let (base_url, captured) = serve_one_request(ANTHROPIC_MESSAGES_BODY).await;
        let config = AgentConfig::new().with_max_tokens(555);
        let agent =
            create_anthropic_agent("probe-key", Some(&base_url), "claude-sonnet-4-5", &config)
                .expect("anthropic agent should build");
        fire_prompt(&agent).await;
        let body = captured_json(&captured);
        assert_eq!(body["max_tokens"], json!(555));
    }

    #[tokio::test]
    async fn custom_openai_api_style_selects_the_wire() {
        let (base_url, captured) = serve_one_request(OPENAI_RESPONSES_BODY).await;
        let agent = create_provider_agent(
            "custom_openai",
            "probe-model",
            Some("probe-key"),
            Some(&base_url),
            None,
            &AgentConfig::new(),
        )
        .expect("custom openai agent should build");
        fire_prompt(&agent).await;
        assert!(
            captured_path(&captured).ends_with("/responses"),
            "unset api_style must default to the Responses API"
        );

        let (base_url, captured) = serve_one_request(CHAT_COMPLETIONS_BODY).await;
        let agent = create_provider_agent(
            "custom_openai",
            "probe-model",
            Some("probe-key"),
            Some(&base_url),
            Some("chat_completions"),
            &AgentConfig::new(),
        )
        .expect("custom openai agent should build");
        fire_prompt(&agent).await;
        assert!(
            captured_path(&captured).ends_with("/chat/completions"),
            "chat_completions api_style must switch the wire"
        );
    }
}
