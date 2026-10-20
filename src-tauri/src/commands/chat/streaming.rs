//! Agent-based streaming for LLM responses

use super::super::AppState;
use super::attachment_processing::StoredImage;
use super::aux_models::ConversationModel;
use crate::llm::agent_builder::{
    AgentConfig, build_assistant_message, build_assistant_message_with_tool_calls,
    build_tool_result_message, build_user_message, create_provider_agent, stream_chat_with_agent,
};
use crate::llm::tools::{BashTool, TempFileList};
use crate::llm::tools::{
    HttpUrlByteFetcher, McpSchemaTool, McpServerCatalog, McpToolUseTool, SkillCatalogEntry,
    SkillTool, VisionQuestionResponder,
};
use crate::llm::{ChatMessage, ChatResponse, StreamChunkType};
use crate::mcp::sync_tool_definitions;
use crate::models::{
    CreateContentBlockRequest, CreateFileAttachmentRequest, CreateMessageRequest,
    CreateThinkingStepRequest, CreateToolCallRequest, McpTransportType, ModelParameters,
};
use crate::prompts;
use rig::agent::Agent;
use rig::completion::Message as RigMessage;
use rmcp::RoleClient;
use rmcp::model::Tool as RmcpTool;
use rmcp::service::Peer;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use super::title::auto_generate_title_if_needed;
use crate::db::tools::{
    BUILTIN_BASH_ID, BUILTIN_EDIT_ID, BUILTIN_GLOB_ID, BUILTIN_GREP_ID, BUILTIN_KILL_SHELL_ID,
    BUILTIN_READ_ID, BUILTIN_WEB_FETCH_ID, BUILTIN_WEB_SEARCH_ID, BUILTIN_WRITE_ID,
};

/// RAII guard that deletes tracked bash temp files when the streaming task exits
/// (via any path: success, error, or cancellation).
struct BashTempFileGuard {
    files: TempFileList,
}

impl Drop for BashTempFileGuard {
    fn drop(&mut self) {
        BashTool::<chatshell_agent_core::process_api::TokioSpawner>::cleanup_temp_files(
            &self.files,
        );
    }
}

/// Everything the streaming phase needs from the config/wiring phase.
/// Built by `handle_agent_streaming` after the agent is created; consumed
/// by `run_agent_stream`, which is generic over the runtime so tests can
/// drive it with a mock app handle and a scripted agent.
struct AgentStreamContext {
    conversation_id: String,
    /// Raw user text for this turn (prompt fallback and title generation).
    content: String,
    /// Whether an explicit system prompt was provided (history system
    /// messages are folded into it and skipped).
    system_prompt_provided: bool,
    model_id: String,
    provider_type: String,
    model_db_id: Option<String>,
    assistant_db_id: Option<String>,
    disable_tools: bool,
    stored_images: Vec<StoredImage>,
    supports_vision: Option<bool>,
    /// MCP tool name -> server DB id (auth-error re-probing).
    mcp_tool_name_to_server_id: Arc<HashMap<String, String>>,
    /// MCP tool name -> user-visible server name (display names).
    mcp_tool_name_to_server_name: Arc<HashMap<String, String>>,
}

/// Handle streaming using the agent-based approach
/// This provides built-in support for preamble, temperature, max_tokens, etc.
pub(crate) async fn handle_agent_streaming(
    provider_type: String,
    model_id: String,
    chat_messages: Vec<ChatMessage>,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
    system_prompt: Option<String>,
    model_params: ModelParameters,
    cancel_token: CancellationToken,
    state_clone: AppState,
    app: tauri::AppHandle,
    conversation_id_clone: String,
    content: String,
    model_db_id: Option<String>,
    assistant_db_id: Option<String>,
    disable_tools: bool,
    stored_images: Vec<StoredImage>,
) {
    tracing::info!(
        "✅ [agent_streaming] Using {} provider with agent API",
        provider_type
    );

    // Build agent config from system prompt and model parameters
    let mut config = AgentConfig::new().with_model_params(model_params);

    // Start with the base system prompt
    let mut effective_system_prompt = system_prompt.clone().unwrap_or_default();

    // Collect all enabled tool IDs from:
    // 1. Assistant's configured tools
    // 2. Skill-required tools
    // 3. Conversation settings (per-conversation overrides)
    let mut all_enabled_tool_ids: Vec<String> = Vec::new();

    // Collect enabled skills for the catalog (assistant + conversation level)
    // Instead of injecting full instructions, we build a compact catalog
    // and let the LLM use the `read` tool to load SKILL.md on demand.
    struct SkillEntry {
        name: String,
        description: Option<String>,
        path: String,
    }
    let mut skill_entries: Vec<SkillEntry> = Vec::new();

    if disable_tools {
        tracing::info!(
            "🚫 [agent_streaming] Tools disabled (e.g. translation mode); skipping all tool and skill loading"
        );
    } else {
        // Load assistant's configured tools and skills
        if let Some(ref assistant_id) = assistant_db_id {
            match state_clone.db.get_assistant_tool_ids(assistant_id).await {
                Ok(ids) => {
                    if !ids.is_empty() {
                        tracing::info!(
                            "🛠️ [agent_streaming] Assistant has {} configured tool(s)",
                            ids.len()
                        );
                        all_enabled_tool_ids.extend(ids);
                    }
                }
                Err(e) => {
                    tracing::warn!("⚠️ [agent_streaming] Failed to load assistant tools: {}", e);
                }
            }

            // Load assistant skills: collect catalog entries + auto-enable required tools
            match state_clone.db.get_assistant_skill_ids(assistant_id).await {
                Ok(skill_ids) => {
                    if !skill_ids.is_empty() {
                        tracing::info!(
                            "📋 [agent_streaming] Assistant has {} configured skill(s)",
                            skill_ids.len()
                        );
                    }
                    for skill_id in &skill_ids {
                        if let Ok(Some(skill)) = state_clone.db.get_skill(skill_id).await
                            && skill.is_enabled
                        {
                            let skill_md_path =
                                format!("{}/SKILL.md", skill.path.trim_end_matches('/'));
                            tracing::info!(
                                "📋 [agent_streaming] Adding skill '{}' to catalog (path: {})",
                                skill.name,
                                skill_md_path
                            );
                            skill_entries.push(SkillEntry {
                                name: skill.name.clone(),
                                description: skill.description.clone(),
                                path: skill_md_path,
                            });
                            for tool_id in &skill.required_tool_ids {
                                if !all_enabled_tool_ids.contains(tool_id) {
                                    tracing::info!(
                                        "🔧 [agent_streaming] Auto-enabling tool '{}' required by skill '{}'",
                                        tool_id,
                                        skill.name
                                    );
                                    all_enabled_tool_ids.push(tool_id.clone());
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "⚠️ [agent_streaming] Failed to load assistant skills: {}",
                        e
                    );
                }
            }
        }
    }

    // Load conversation-level tool overrides (additive)
    let conv_settings = state_clone
        .db
        .get_conversation_settings(&conversation_id_clone)
        .await
        .ok();

    if !disable_tools {
        if let Some(ref settings) = conv_settings {
            for id in &settings.enabled_mcp_server_ids {
                if !all_enabled_tool_ids.contains(id) {
                    all_enabled_tool_ids.push(id.clone());
                }
            }

            // Load conversation-level skills into catalog
            if !settings.enabled_skill_ids.is_empty() {
                tracing::info!(
                    "📋 [agent_streaming] Conversation has {} enabled skill(s)",
                    settings.enabled_skill_ids.len()
                );
                for skill_id in &settings.enabled_skill_ids {
                    match state_clone.db.get_skill(skill_id).await {
                        Ok(Some(skill)) => {
                            if skill.is_enabled {
                                let skill_md_path =
                                    format!("{}/SKILL.md", skill.path.trim_end_matches('/'));
                                // Avoid duplicates (skill may already be in catalog from assistant)
                                if !skill_entries.iter().any(|e| e.path == skill_md_path) {
                                    tracing::info!(
                                        "📋 [agent_streaming] Adding conversation skill '{}' to catalog",
                                        skill.name
                                    );
                                    skill_entries.push(SkillEntry {
                                        name: skill.name.clone(),
                                        description: skill.description.clone(),
                                        path: skill_md_path,
                                    });
                                }
                                for tool_id in &skill.required_tool_ids {
                                    if !all_enabled_tool_ids.contains(tool_id) {
                                        tracing::info!(
                                            "🔧 [agent_streaming] Auto-enabling tool '{}' required by conversation skill '{}'",
                                            tool_id,
                                            skill.name
                                        );
                                        all_enabled_tool_ids.push(tool_id.clone());
                                    }
                                }
                            }
                        }
                        Ok(None) => {
                            tracing::warn!(
                                "⚠️ [agent_streaming] Conversation skill '{}' not found",
                                skill_id
                            );
                        }
                        Err(e) => {
                            tracing::warn!(
                                "⚠️ [agent_streaming] Failed to load conversation skill '{}': {}",
                                skill_id,
                                e
                            );
                        }
                    }
                }
            }
        }
    }

    // Append environment info block to system prompt (skip for tool-less modes like translation)
    if !disable_tools {
        {
            use chrono::Local;

            let today = Local::now().format("%a %b %d %Y").to_string();
            let env_block = build_env_block(
                &provider_type,
                &model_id,
                &today,
                os_platform_label(std::env::consts::OS),
                conv_settings
                    .as_ref()
                    .and_then(|s| s.working_directory.as_deref()),
            );

            effective_system_prompt.push_str(&env_block);
        }
    }

    // Check model capabilities and strip unsupported features
    let capabilities = state_clone
        .capabilities_cache
        .resolve(&provider_type, &model_id)
        .await;

    if capabilities.supports_tool_use == Some(false) {
        if !all_enabled_tool_ids.is_empty() || !skill_entries.is_empty() {
            tracing::info!(
                "🚫 [agent_streaming] Model '{}' does not support tool use; skipping {} tool(s) and {} skill(s)",
                model_id,
                all_enabled_tool_ids.len(),
                skill_entries.len()
            );
        }
        all_enabled_tool_ids.clear();
        skill_entries.clear();
    }

    // Build skill tool with embedded catalog (progressive disclosure via tool description)
    if !skill_entries.is_empty() {
        let catalog: Vec<SkillCatalogEntry> = skill_entries
            .iter()
            .map(|e| SkillCatalogEntry {
                name: e.name.clone(),
                description: e.description.clone(),
                path: e.path.clone(),
            })
            .collect();
        config = config.with_skill_tool(SkillTool::new(catalog));
    }

    // Determine which builtin tools are enabled
    let web_search_enabled = all_enabled_tool_ids.contains(&BUILTIN_WEB_SEARCH_ID.to_string());
    let web_fetch_enabled = all_enabled_tool_ids.contains(&BUILTIN_WEB_FETCH_ID.to_string());
    let bash_enabled = all_enabled_tool_ids.contains(&BUILTIN_BASH_ID.to_string());
    let kill_shell_enabled = all_enabled_tool_ids.contains(&BUILTIN_KILL_SHELL_ID.to_string());
    let read_enabled = all_enabled_tool_ids.contains(&BUILTIN_READ_ID.to_string());
    let edit_enabled = all_enabled_tool_ids.contains(&BUILTIN_EDIT_ID.to_string());
    let write_enabled = all_enabled_tool_ids.contains(&BUILTIN_WRITE_ID.to_string());
    let grep_enabled = all_enabled_tool_ids.contains(&BUILTIN_GREP_ID.to_string());
    let glob_enabled = all_enabled_tool_ids.contains(&BUILTIN_GLOB_ID.to_string());

    if web_search_enabled {
        let search_provider = state_clone.db.get_search_provider().await;
        tracing::info!(
            "🔍 [agent_streaming] Enabling web_search tool with provider: {}",
            search_provider
        );
        config = config
            .with_web_search()
            .with_search_provider(search_provider);
    }
    if web_fetch_enabled {
        tracing::info!("🌐 [agent_streaming] Enabling web_fetch tool");
        let fetch_config = super::url_processing::load_fetch_config(&state_clone).await;
        config = config.with_web_fetch().with_fetch_config(fetch_config);
    }
    // Temp file tracker for bash output truncation; the RAII guard ensures cleanup
    // on any exit path (success, error, cancel).
    let bash_temp_files: TempFileList = Arc::new(std::sync::Mutex::new(Vec::new()));
    let _temp_file_guard = BashTempFileGuard {
        files: bash_temp_files.clone(),
    };

    if bash_enabled {
        tracing::info!("🖥️ [agent_streaming] Enabling bash tool");
        config = config.with_bash();

        let (session, abort_notify) = state_clone
            .bash_session_manager
            .get_or_create(&conversation_id_clone);
        config = config.with_bash_session(session);
        config = config.with_bash_abort_notify(abort_notify);
        config = config.with_bash_temp_files(bash_temp_files.clone());

        if let Some(ref settings) = conv_settings
            && let Some(ref working_dir) = settings.working_directory
        {
            tracing::info!(
                "📂 [agent_streaming] Setting bash working directory: {}",
                working_dir
            );
            config = config.with_bash_working_directory(working_dir.clone());
        }
    }
    if kill_shell_enabled && bash_enabled {
        tracing::info!("🔪 [agent_streaming] Enabling kill_shell tool");
        config = config.with_kill_shell();
    }
    if read_enabled {
        tracing::info!("📖 [agent_streaming] Enabling read tool");
        config = config.with_read();

        // Vision seam: wire an image-question responder when a vision model
        // resolves, and declare whether the main model accepts image input
        // (drives the read tool's metadata fallback for text-only models).
        let conversation = ConversationModel {
            provider_type: provider_type.clone(),
            model_id: model_id.clone(),
            api_key: api_key.clone(),
            base_url: base_url.clone(),
            api_style: api_style.clone(),
            supports_vision: capabilities.supports_vision,
        };
        if let Some(aux) = super::aux_models::resolve_aux_vision(&state_clone, &conversation).await
        {
            config = config.with_read_image_question(Arc::new(VisionQuestionResponder::new(
                aux.provider_type,
                aux.model_id,
                aux.api_key,
                aux.base_url,
                aux.api_style,
            )));
        } else {
            tracing::info!(
                "👁️ [agent_streaming] No vision model for image questions; metadata fallback only"
            );
        }
        config = config.with_read_main_model_vision(capabilities.supports_vision != Some(false));
        if web_fetch_enabled {
            config = config.with_read_url_fetcher(Arc::new(HttpUrlByteFetcher));
        }
    }
    if edit_enabled {
        tracing::info!("✏️ [agent_streaming] Enabling edit tool");
        config = config.with_edit();
    }
    if write_enabled {
        tracing::info!("📝 [agent_streaming] Enabling write tool");
        config = config.with_write();
    }
    if grep_enabled {
        tracing::info!("🔎 [agent_streaming] Enabling grep tool");
        config = config.with_grep();

        if let Some(ref settings) = conv_settings
            && let Some(ref working_dir) = settings.working_directory
        {
            tracing::info!(
                "📂 [agent_streaming] Setting grep working directory: {}",
                working_dir
            );
            config = config.with_grep_working_directory(working_dir.clone());
        }
    }
    if glob_enabled {
        tracing::info!("📂 [agent_streaming] Enabling glob tool");
        config = config.with_glob();

        if let Some(ref settings) = conv_settings
            && let Some(ref working_dir) = settings.working_directory
        {
            tracing::info!(
                "📂 [agent_streaming] Setting glob working directory: {}",
                working_dir
            );
            config = config.with_glob_working_directory(working_dir.clone());
        }
    }

    // Apply project_root security boundary from conversation working directory
    if let Some(ref settings) = conv_settings
        && let Some(ref working_dir) = settings.working_directory
    {
        let root = PathBuf::from(working_dir);
        tracing::info!(
            "🛡️ [agent_streaming] Enforcing project root security boundary: {}",
            working_dir
        );
        config = config.with_project_root(root);
    }

    // Collect MCP server IDs (non-builtin tools)
    let mcp_server_ids: Vec<String> = collect_mcp_server_ids(&all_enabled_tool_ids);
    // Load MCP tools from enabled servers and build McpSchemaTool + McpToolUseTool
    let (mcp_tool_name_to_server_id, mcp_tool_name_to_server_name): (
        Arc<HashMap<String, String>>,
        Arc<HashMap<String, String>>,
    ) = if !mcp_server_ids.is_empty() {
        let loaded = load_mcp_tools_by_ids(&state_clone, &mcp_server_ids).await;
        if let Some(loaded) = loaded {
            for server_id in &loaded.auth_failed_server_ids {
                tracing::warn!(
                    "🔐 [agent_streaming] MCP server {} failed auth, emitting mcp-auth-required",
                    server_id
                );
                let payload = serde_json::json!({
                    "conversation_id": conversation_id_clone,
                    "server_id": server_id,
                });
                let _ = app.emit("mcp-auth-required", payload);
            }

            if loaded.server_tools.iter().any(|(t, _)| !t.is_empty()) {
                let total: usize = loaded.server_tools.iter().map(|(t, _)| t.len()).sum();
                tracing::info!(
                    "🔌 [agent_streaming] Loaded {} MCP tools from {} server(s)",
                    total,
                    loaded.server_tools.len()
                );

                let mcp_tools_dir = app
                    .path()
                    .app_cache_dir()
                    .map(|d| d.join("mcp-tools"))
                    .unwrap_or_else(|_| std::env::temp_dir().join("chatshell-mcp-tools"));
                if let Err(e) = std::fs::create_dir_all(&mcp_tools_dir) {
                    tracing::warn!("⚠️ [agent_streaming] Failed to create mcp-tools dir: {}", e);
                }

                let mut client_map: HashMap<String, (String, Peer<RoleClient>)> = HashMap::new();
                let mut server_catalogs: Vec<McpServerCatalog> = Vec::new();

                for (tools, client) in &loaded.server_tools {
                    if tools.is_empty() {
                        continue;
                    }
                    let server_name = tools
                        .first()
                        .and_then(|t| loaded.tool_name_to_server_name.get(&t.name.to_string()))
                        .cloned()
                        .unwrap_or_else(|| "unknown".to_string());

                    match sync_tool_definitions(&mcp_tools_dir, &server_name, tools) {
                        Ok(_server_dir) => {
                            let mut catalog_tools: Vec<(String, String)> = Vec::new();
                            for tool in tools {
                                let desc = tool.description.as_deref().unwrap_or("No description");
                                let key = format!("{}/{}", server_name, tool.name);
                                client_map.insert(key, (server_name.clone(), client.clone()));
                                catalog_tools.push((tool.name.to_string(), desc.to_string()));
                            }
                            server_catalogs.push(McpServerCatalog {
                                name: server_name,
                                tools: catalog_tools,
                            });
                        }
                        Err(e) => {
                            tracing::warn!(
                                "⚠️ [agent_streaming] Failed to sync tool definitions \
                                 for server '{}': {}",
                                server_name,
                                e
                            );
                        }
                    }
                }

                config = config
                    .with_mcp_schema_tool(McpSchemaTool::new(
                        server_catalogs,
                        mcp_tools_dir.to_string_lossy().to_string(),
                    ))
                    .with_mcp_tool_use(McpToolUseTool::new(
                        Arc::new(RwLock::new(client_map)),
                        loaded.tool_name_to_transport.clone(),
                    ));
            }
            (
                Arc::new(loaded.tool_name_to_server_id),
                Arc::new(loaded.tool_name_to_server_name),
            )
        } else {
            (Arc::new(HashMap::new()), Arc::new(HashMap::new()))
        }
    } else {
        (Arc::new(HashMap::new()), Arc::new(HashMap::new()))
    };

    // Inject workflow instructions for skills and MCP tools
    if !skill_entries.is_empty() {
        effective_system_prompt.push_str("\n\n");
        effective_system_prompt.push_str(prompts::SKILL_INSTRUCTIONS);
    }
    if config.mcp_schema_tool.is_some() {
        effective_system_prompt.push_str("\n\n");
        effective_system_prompt.push_str(prompts::MCP_INSTRUCTIONS);
    }

    if !effective_system_prompt.is_empty() {
        config = config.with_system_prompt(effective_system_prompt);
    }

    // Create the agent
    let agent = match create_provider_agent(
        &provider_type,
        &model_id,
        api_key.as_deref(),
        base_url.as_deref(),
        api_style.as_deref(),
        &config,
    ) {
        Ok(a) => a,
        Err(e) => {
            tracing::error!("❌ [agent_streaming] Failed to create agent: {}", e);
            let error_payload = serde_json::json!({
                "conversation_id": conversation_id_clone,
                "error": format!("Failed to create agent: {}", e),
            });
            let _ = app.emit("chat-error", error_payload);
            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            return;
        }
    };

    // Auto-generate title for new conversations early (only needs user message).
    // Fire-and-forget: runs concurrently with the LLM streaming below.
    {
        let state_for_title = state_clone.clone();
        let app_for_title = app.clone();
        let conversation_id_for_title = conversation_id_clone.clone();
        let content_for_title = content.clone();
        let provider_for_title = provider_type.clone();
        let model_for_title = model_id.clone();
        let api_key_for_title = api_key.clone();
        let base_url_for_title = base_url.clone();
        let api_style_for_title = api_style.clone();

        tokio::spawn(async move {
            auto_generate_title_if_needed(
                &state_for_title,
                &app_for_title,
                &conversation_id_for_title,
                &content_for_title,
                &provider_for_title,
                &model_for_title,
                api_key_for_title,
                base_url_for_title,
                api_style_for_title,
            )
            .await;
        });
    }

    run_agent_stream(
        &app,
        &state_clone,
        agent,
        chat_messages,
        cancel_token,
        AgentStreamContext {
            conversation_id: conversation_id_clone,
            content,
            system_prompt_provided: system_prompt.is_some(),
            model_id,
            provider_type,
            model_db_id,
            assistant_db_id,
            disable_tools,
            stored_images,
            supports_vision: capabilities.supports_vision,
            mcp_tool_name_to_server_id,
            mcp_tool_name_to_server_name,
        },
    )
    .await;
}

/// Drive an already-created agent through the streaming pipeline: vision
/// strip, history conversion, the chunk callback (event emission and
/// accumulation), response/error/cancel handling, and the persistence
/// tail. Split out of `handle_agent_streaming` (which keeps config
/// loading, MCP wiring, and agent creation) so the pipeline can be
/// exercised offline with a scripted agent and a mock-runtime app handle.
async fn run_agent_stream<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state_clone: &AppState,
    agent: Agent,
    chat_messages: Vec<ChatMessage>,
    cancel_token: CancellationToken,
    ctx: AgentStreamContext,
) {
    let AgentStreamContext {
        conversation_id: conversation_id_clone,
        content,
        system_prompt_provided,
        model_id,
        provider_type,
        model_db_id,
        assistant_db_id,
        disable_tools,
        stored_images,
        supports_vision,
        mcp_tool_name_to_server_id,
        mcp_tool_name_to_server_name,
    } = ctx;

    // Strip images if model does not support vision. The current turn's
    // images are persisted as file attachments, so instead of silently
    // losing them, annotate the final user message with their storage
    // paths — the model can inspect them with `read` (optionally with the
    // `question` argument, answered by the aux vision model).
    let chat_messages = if supports_vision == Some(false) {
        let image_count: usize = chat_messages.iter().map(|m| m.images.len()).sum();
        if image_count > 0 {
            tracing::warn!(
                "🚫 [agent_streaming] Model '{}' does not support vision; dropping {} image(s) from direct input",
                model_id,
                image_count
            );
            let _ = app.emit(
                "chat-warning",
                serde_json::json!({
                    "conversation_id": conversation_id_clone,
                    "warning": "model_no_vision",
                    "images": image_count,
                    "annotated": !stored_images.is_empty(),
                }),
            );
        }
        let resolved_images: Vec<(String, String)> = stored_images
            .iter()
            .filter_map(
                |img| match crate::storage::get_full_path(app, &img.storage_path) {
                    Ok(full) => Some((img.name.clone(), full.to_string_lossy().into_owned())),
                    Err(e) => {
                        tracing::warn!(
                            "🚫 [agent_streaming] Could not resolve storage path for {}: {}",
                            img.name,
                            e
                        );
                        None
                    }
                },
            )
            .collect();
        let annotation = format_image_annotations(&resolved_images, !disable_tools);
        let mut chat_messages = chat_messages;
        let annotate_last = image_count > 0 && !resolved_images.is_empty();
        for m in chat_messages.iter_mut() {
            m.images.clear();
        }
        if annotate_last
            && let Some(last_user) = chat_messages
                .iter_mut()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| &mut m.content)
        {
            last_user.push_str("\n\n");
            last_user.push_str(&annotation);
        }
        chat_messages
    } else {
        chat_messages
    };

    // Convert ChatMessages to rig's Message format for history
    let mut chat_history: Vec<RigMessage> = Vec::new();
    let mut current_prompt: Option<RigMessage> = None;

    for (i, msg) in chat_messages.iter().enumerate() {
        let is_last = i == chat_messages.len() - 1;
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
                build_tool_result_message(tc_id, msg.tool_result_call_id.as_deref(), &msg.content)
            }
            "system" => {
                if system_prompt_provided {
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

    // Use the last user message as prompt, or create one from content
    let prompt = current_prompt.unwrap_or_else(|| build_user_message(&content, &[], &[]));

    // Track accumulated content for events
    let accumulated_content = Arc::new(RwLock::new(String::new()));
    let accumulated_reasoning = Arc::new(RwLock::new(String::new()));
    let accumulated_images: Arc<RwLock<Vec<String>>> = Arc::new(RwLock::new(Vec::new()));
    let reasoning_started = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Track display order for proper interleaving of thinking, tool calls, and content
    // display_order_counter increments whenever we transition between content/thinking/tool calls
    let display_order_counter = Arc::new(std::sync::atomic::AtomicI32::new(0));

    // Track current content block being accumulated (will be flushed before tool calls)
    let current_content_block = Arc::new(RwLock::new(String::new()));

    // Track content blocks with their display order: Vec<(display_order, content)>
    let content_blocks: Arc<RwLock<Vec<(i32, String)>>> = Arc::new(RwLock::new(Vec::new()));

    // Track reasoning/thinking blocks with display order: Vec<(display_order, content)>
    let reasoning_blocks: Arc<RwLock<Vec<(i32, String)>>> = Arc::new(RwLock::new(Vec::new()));

    // Track current reasoning block being accumulated
    let current_reasoning_block = Arc::new(RwLock::new(String::new()));
    let current_reasoning_order = Arc::new(std::sync::atomic::AtomicI32::new(-1));

    // Track tool calls: HashMap<tool_call_id, (display_order, tool_name, tool_input, tool_output, call_id)>
    let tool_calls_map: Arc<
        RwLock<
            std::collections::HashMap<
                String,
                (i32, String, String, Option<String>, Option<String>),
            >,
        >,
    > = Arc::new(RwLock::new(std::collections::HashMap::new()));

    let accumulated_content_for_callback = accumulated_content.clone();
    let accumulated_reasoning_for_callback = accumulated_reasoning.clone();
    let accumulated_images_for_callback = accumulated_images.clone();
    let reasoning_started_for_callback = reasoning_started.clone();
    let display_order_for_callback = display_order_counter.clone();
    let current_content_for_callback = current_content_block.clone();
    let content_blocks_for_callback = content_blocks.clone();
    let reasoning_blocks_for_callback = reasoning_blocks.clone();
    let current_reasoning_for_callback = current_reasoning_block.clone();
    let current_reasoning_order_for_callback = current_reasoning_order.clone();
    let tool_calls_for_callback = tool_calls_map.clone();
    let conversation_id_for_stream = conversation_id_clone.clone();
    let app_for_stream = app.clone();
    let cancel_token_for_callback = cancel_token.clone();
    let mcp_tool_map_for_callback = mcp_tool_name_to_server_id.clone();
    let mcp_server_name_map_for_callback = mcp_tool_name_to_server_name.clone();
    let mcp_manager_for_callback = state_clone.mcp_manager.clone();

    // Stream using the agent
    let response = stream_chat_with_agent(
        agent,
        prompt,
        chat_history,
        cancel_token.clone(),
        move |chunk: String, chunk_type: StreamChunkType| -> bool {
            // Check if cancelled
            if cancel_token_for_callback.is_cancelled() {
                tracing::info!("🛑 [agent_streaming] Generation cancelled, stopping stream");
                return false;
            }

            match chunk_type {
                StreamChunkType::Text => {
                    // Accumulate text content (for final message)
                    if let Ok(mut content) = accumulated_content_for_callback.try_write() {
                        content.push_str(&chunk);
                    }

                    // Also accumulate into current content block for proper ordering
                    if let Ok(mut current_block) = current_content_for_callback.try_write() {
                        current_block.push_str(&chunk);
                    }

                    let payload = serde_json::json!({
                        "conversation_id": conversation_id_for_stream,
                        "content": chunk,
                    });
                    let _ = app_for_stream.emit("chat-stream", payload);
                }
                StreamChunkType::Reasoning => {
                    // Emit reasoning-started event on first reasoning chunk
                    if !reasoning_started_for_callback
                        .swap(true, std::sync::atomic::Ordering::SeqCst)
                    {
                        // First reasoning chunk - flush any pending content block
                        if let Ok(mut current_block) = current_content_for_callback.try_write()
                            && !current_block.trim().is_empty()
                        {
                            let order = display_order_for_callback
                                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            if let Ok(mut blocks) = content_blocks_for_callback.try_write() {
                                blocks.push((order, current_block.clone()));
                            }
                            current_block.clear();
                        }

                        // Set current reasoning order
                        let order = display_order_for_callback
                            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        current_reasoning_order_for_callback
                            .store(order, std::sync::atomic::Ordering::SeqCst);

                        let started_payload = serde_json::json!({
                            "conversation_id": conversation_id_for_stream,
                        });
                        let _ = app_for_stream.emit("reasoning-started", started_payload);
                    }

                    // Accumulate reasoning content
                    if let Ok(mut reasoning) = accumulated_reasoning_for_callback.try_write() {
                        reasoning.push_str(&chunk);
                    }

                    // Also accumulate into current reasoning block
                    if let Ok(mut current_reasoning) = current_reasoning_for_callback.try_write() {
                        current_reasoning.push_str(&chunk);
                    }

                    let payload = serde_json::json!({
                        "conversation_id": conversation_id_for_stream,
                        "content": chunk,
                    });
                    let _ = app_for_stream.emit("chat-stream-reasoning", payload);
                }
                StreamChunkType::ToolCall(tool_info) => {
                    // Flush any pending reasoning block before tool call
                    if let Ok(mut current_reasoning) = current_reasoning_for_callback.try_write()
                        && !current_reasoning.trim().is_empty()
                    {
                        let order = current_reasoning_order_for_callback
                            .load(std::sync::atomic::Ordering::SeqCst);
                        if order >= 0
                            && let Ok(mut blocks) = reasoning_blocks_for_callback.try_write()
                        {
                            blocks.push((order, current_reasoning.clone()));
                        }
                        current_reasoning.clear();
                    }
                    // Reset reasoning started for next round
                    reasoning_started_for_callback
                        .store(false, std::sync::atomic::Ordering::SeqCst);

                    // Flush any pending content block before tool call
                    if let Ok(mut current_block) = current_content_for_callback.try_write()
                        && !current_block.trim().is_empty()
                    {
                        let order = display_order_for_callback
                            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        if let Ok(mut blocks) = content_blocks_for_callback.try_write() {
                            blocks.push((order, current_block.clone()));
                        }
                        current_block.clear();
                    }

                    // Get display order for this tool call
                    let tool_order = display_order_for_callback
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

                    // For mcp meta-tool, extract server, real MCP tool name, and inner arguments
                    let (actual_tool_name, display_name, display_input) = resolve_tool_display(
                        &tool_info.tool_name,
                        &tool_info.tool_input,
                        &mcp_server_name_map_for_callback,
                    );

                    // Store tool call in tracking map (actual MCP tool name for auth lookup)
                    if let Ok(mut tool_calls) = tool_calls_for_callback.try_write() {
                        tool_calls.insert(
                            tool_info.id.clone(),
                            (
                                tool_order,
                                actual_tool_name,
                                display_input.clone(),
                                None,
                                tool_info.call_id.clone(),
                            ),
                        );
                    }

                    // Emit tool call event to frontend with display name
                    let payload = serde_json::json!({
                        "conversation_id": conversation_id_for_stream,
                        "tool_call_id": tool_info.id,
                        "tool_name": display_name,
                        "tool_input": display_input,
                    });
                    let _ = app_for_stream.emit("tool-call-started", payload);
                }
                StreamChunkType::ToolResult(result_info) => {
                    // Update tool call with result
                    if let Ok(mut tool_calls) = tool_calls_for_callback.try_write()
                        && let Some((_, name, input, output, _)) =
                            tool_calls.get_mut(&result_info.id)
                    {
                        *output = Some(result_info.tool_output.clone());

                        // Detect 401 auth errors from MCP tool calls (uses original name)
                        if is_auth_error(&result_info.tool_output)
                            && let Some(server_id) = mcp_tool_map_for_callback.get(name.as_str()) {
                                tracing::warn!(
                                    "🔐 [agent_streaming] MCP tool '{}' returned auth error, server: {}",
                                    name, server_id
                                );
                                let server_id = server_id.clone();
                                let app_handle = app_for_stream.clone();
                                let conv_id = conversation_id_for_stream.clone();
                                let manager = mcp_manager_for_callback.clone();
                                tokio::spawn(async move {
                                    manager.disconnect(&server_id).await;
                                    let payload = serde_json::json!({
                                        "conversation_id": conv_id,
                                        "server_id": server_id,
                                    });
                                    let _ = app_handle.emit("mcp-auth-required", payload);
                                });
                            }

                        // Build display name for frontend (name may be composite "server/tool" in lazy-load)
                        let display_name =
                            mcp_display_name_from_stored(name, &mcp_server_name_map_for_callback);

                        // Emit tool result event to frontend
                        let payload = serde_json::json!({
                            "conversation_id": conversation_id_for_stream,
                            "tool_call_id": result_info.id,
                            "tool_name": display_name,
                            "tool_input": input.clone(),
                            "tool_output": result_info.tool_output,
                        });
                        let _ = app_for_stream.emit("tool-call-completed", payload);
                    }
                }
                StreamChunkType::Image(data_url) => {
                    let is_duplicate = if let Ok(mut images) =
                        accumulated_images_for_callback.try_write()
                    {
                        if is_duplicate_image(&images, &data_url) {
                            tracing::info!(
                                "🖼️ [streaming] Skipping duplicate image ({} bytes, similar to existing)",
                                data_url.len()
                            );
                            true
                        } else {
                            images.push(data_url.clone());
                            false
                        }
                    } else {
                        false
                    };

                    if !is_duplicate {
                        let payload = serde_json::json!({
                            "conversation_id": conversation_id_for_stream,
                            "image_url": data_url,
                        });
                        let _ = app_for_stream.emit("chat-stream-image", payload);
                    }
                }
            }

            true // Continue streaming
        },
        &provider_type,
    )
    .await;

    // Handle the response: on cancellation build synthetic response so we can save accumulated data
    let (response, was_stream_error) = match response {
        Ok(r) => (r, false),
        Err(e) => {
            if cancel_token.is_cancelled() {
                tracing::info!("🛑 [agent_streaming] Generation cancelled (stream returned error)");
                let accumulated = accumulated_content.read().await.clone();
                let accumulated_reason = accumulated_reasoning.read().await.clone();
                let parsed = crate::thinking_parser::parse_thinking_content(&accumulated);
                let thinking = if !accumulated_reason.is_empty() {
                    Some(accumulated_reason)
                } else {
                    parsed.thinking_content
                };
                (
                    ChatResponse {
                        content: parsed.content,
                        thinking_content: thinking,
                        tokens: None,
                    },
                    true,
                )
            } else {
                tracing::error!("❌ [agent_streaming] Stream error: {}", e);
                let error_payload = serde_json::json!({
                    "conversation_id": conversation_id_clone,
                    "error": e.to_string(),
                });
                let _ = app.emit("chat-error", error_payload);
                let mut tasks = state_clone.generation_tasks.write().await;
                tasks.remove(&conversation_id_clone);
                return;
            }
        }
    };

    let was_cancelled = cancel_token.is_cancelled();
    let final_content = response.content.clone();

    if was_cancelled {
        tracing::info!(
            "🛑 [agent_streaming] Cancelled. Content: {} chars, stream_error: {}",
            final_content.len(),
            was_stream_error
        );
    } else {
        tracing::info!(
            "✅ [agent_streaming] Response complete: {} chars",
            final_content.len()
        );
    }

    // Check if we have any data worth saving
    let has_tool_calls = !tool_calls_map.read().await.is_empty();
    let has_reasoning_blocks = !reasoning_blocks.read().await.is_empty()
        || !current_reasoning_block.read().await.trim().is_empty();
    let has_content_blocks = !content_blocks.read().await.is_empty()
        || !current_content_block.read().await.trim().is_empty();
    let has_thinking = response
        .thinking_content
        .as_ref()
        .is_some_and(|t| !t.is_empty());
    let has_images = !accumulated_images.read().await.is_empty();
    let has_any = has_any_data(
        &final_content,
        has_tool_calls,
        has_reasoning_blocks,
        has_content_blocks,
        has_thinking,
        has_images,
    );

    if !has_any {
        if was_cancelled {
            tracing::info!("⚠️ [agent_streaming] Cancelled with no data to save");
            let payload = serde_json::json!({
                "conversation_id": conversation_id_clone,
                "message": null,
                "cancelled": true,
            });
            let _ = app.emit("chat-complete", payload);
        } else {
            tracing::info!("⚠️ [agent_streaming] Skipping save of empty response");
            let error_payload = serde_json::json!({
                "conversation_id": conversation_id_clone,
                "error": "Model returned empty response",
            });
            let _ = app.emit("chat-error", error_payload);
        }
        let mut tasks = state_clone.generation_tasks.write().await;
        tasks.remove(&conversation_id_clone);
        return;
    }

    let images_snapshot = accumulated_images.read().await.clone();
    let save_content = if final_content.trim().is_empty() && images_snapshot.is_empty() {
        " ".to_string()
    } else {
        final_content.clone()
    };

    // Determine sender type and ID
    let (sender_type, sender_id) = if let Some(model_id) = model_db_id.clone() {
        ("model".to_string(), Some(model_id))
    } else if let Some(assistant_id) = assistant_db_id.clone() {
        ("assistant".to_string(), Some(assistant_id))
    } else {
        ("assistant".to_string(), None)
    };

    // Save assistant message
    let assistant_message = match state_clone
        .db
        .create_message(CreateMessageRequest {
            conversation_id: Some(conversation_id_clone.clone()),
            sender_type,
            sender_id,
            content: save_content,
            tokens: response.tokens,
        })
        .await
    {
        Ok(msg) => msg,
        Err(e) => {
            tracing::error!("Failed to save assistant message: {}", e);
            let error_payload = serde_json::json!({
                "conversation_id": conversation_id_clone,
                "error": format!("Failed to save message: {}", e),
            });
            let _ = app.emit("chat-error", error_payload);
            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            return;
        }
    };

    // Post-turn compaction check (fire-and-forget): estimates context usage
    // against the model's window and records a compaction row when the
    // threshold is crossed. Only the LLM projection shrinks; the persisted
    // history is untouched.
    {
        let state_for_compaction = state_clone.clone();
        let conversation_for_compaction = conversation_id_clone.clone();
        tokio::spawn(async move {
            super::compaction::run_post_turn_compaction(
                &state_for_compaction,
                &conversation_for_compaction,
            )
            .await;
        });
    }

    // Save generated images as file attachments linked to the assistant message
    if !images_snapshot.is_empty() {
        for (i, data_url) in images_snapshot.iter().enumerate() {
            // Parse data URL: "data:image/png;base64,<base64data>"
            let (mime_type, bytes) = match parse_image_data_url(data_url) {
                Ok(parsed) => parsed,
                Err(ImageDataUrlError::MissingPrefix) => {
                    tracing::error!("Generated image {} is not a data URL, skipping", i + 1);
                    continue;
                }
                Err(ImageDataUrlError::MissingComma) => {
                    tracing::error!("Invalid data URL format for generated image {}", i + 1);
                    continue;
                }
                Err(ImageDataUrlError::Decode(e)) => {
                    tracing::error!("Failed to decode generated image {}: {}", i + 1, e);
                    continue;
                }
            };

            let content_hash = crate::storage::hash_bytes(&bytes);
            let ext = crate::storage::get_extension_for_content_type(&mime_type);
            let file_name = format!("generated-image-{}.{}", i + 1, ext);

            // Check for deduplication
            let storage_path =
                if let Ok(Some(existing)) = state_clone.db.find_file_by_hash(&content_hash).await {
                    existing.storage_path.clone()
                } else {
                    let path = crate::storage::generate_file_storage_path(&content_hash, ext);
                    if let Err(e) = crate::storage::write_binary(app, &path, &bytes) {
                        tracing::error!("Failed to save generated image {}: {}", i + 1, e);
                        continue;
                    }
                    path
                };

            match state_clone
                .db
                .create_file_attachment(CreateFileAttachmentRequest {
                    file_name: file_name.clone(),
                    file_size: bytes.len() as i64,
                    mime_type: mime_type.clone(),
                    storage_path: storage_path.clone(),
                    content_hash,
                })
                .await
            {
                Ok(file_attachment) => {
                    if let Err(e) = state_clone
                        .db
                        .link_message_attachment(
                            &assistant_message.id,
                            &file_attachment.id,
                            Some(i as i32),
                        )
                        .await
                    {
                        tracing::error!("Failed to link generated image to message: {}", e);
                    } else {
                        tracing::info!(
                            "🖼️ [streaming] Saved generated image attachment: {} -> {}",
                            file_name,
                            file_attachment.id
                        );
                    }
                }
                Err(e) => {
                    tracing::error!(
                        "Failed to create file record for generated image {}: {}",
                        i + 1,
                        e
                    );
                }
            }
        }
    }

    // Flush any remaining reasoning block
    {
        let current_reasoning = current_reasoning_block.read().await;
        if !current_reasoning.trim().is_empty() {
            let order = current_reasoning_order.load(std::sync::atomic::Ordering::SeqCst);
            if order >= 0 {
                let mut blocks = reasoning_blocks.write().await;
                blocks.push((order, current_reasoning.clone()));
            }
        }
    }

    // Flush any remaining content block
    {
        let current_block = current_content_block.read().await;
        if !current_block.trim().is_empty() {
            let order = display_order_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let mut blocks = content_blocks.write().await;
            blocks.push((order, current_block.clone()));
        }
    }

    // Save reasoning/thinking blocks with proper display order
    let reasoning_data = reasoning_blocks.read().await;
    if !reasoning_data.is_empty() {
        tracing::info!(
            "💾 [agent_streaming] Saving {} reasoning block(s) to database",
            reasoning_data.len()
        );

        for (order, content) in reasoning_data.iter() {
            if content.trim().is_empty() {
                continue;
            }
            match state_clone
                .db
                .create_thinking_step(CreateThinkingStepRequest {
                    message_id: assistant_message.id.clone(),
                    content: content.clone(),
                    source: Some("llm".to_string()),
                    display_order: Some(*order),
                })
                .await
            {
                Ok(_thinking_step) => {
                    tracing::info!(
                        "✅ [agent_streaming] Thinking step saved with display_order: {}",
                        order
                    );
                }
                Err(e) => {
                    tracing::error!("Failed to save thinking step: {}", e);
                }
            }
        }
    }
    drop(reasoning_data);

    // Save tool calls to database with proper display order
    let tool_calls_data = tool_calls_map.read().await;
    if !tool_calls_data.is_empty() {
        tracing::info!(
            "💾 [agent_streaming] Saving {} tool call(s) to database",
            tool_calls_data.len()
        );

        for (tool_call_id, (display_order, tool_name, tool_input, tool_output, call_id)) in
            tool_calls_data.iter()
        {
            let status = tool_call_status(tool_output.as_ref(), was_cancelled);

            let display_name =
                mcp_display_name_from_stored(tool_name, &mcp_tool_name_to_server_name);

            match state_clone
                .db
                .create_tool_call(CreateToolCallRequest {
                    id: Some(tool_call_id.clone()),
                    call_id: call_id.clone(),
                    message_id: assistant_message.id.clone(),
                    tool_name: display_name,
                    tool_input: Some(tool_input.clone()),
                    tool_output: tool_output.clone(),
                    status: Some(status.to_string()),
                    error: None,
                    duration_ms: None,
                    display_order: Some(*display_order),
                    completed_at: if tool_output.is_some() {
                        Some(chrono::Utc::now().to_rfc3339())
                    } else {
                        None
                    },
                })
                .await
            {
                Ok(tc) => {
                    tracing::info!(
                        "✅ [agent_streaming] Tool call saved: {} ({}) with display_order: {}",
                        tc.tool_name,
                        tc.id,
                        display_order
                    );
                }
                Err(e) => {
                    tracing::error!(
                        "❌ [agent_streaming] Failed to save tool call {}: {}",
                        tool_call_id,
                        e
                    );
                }
            }
        }
    }
    drop(tool_calls_data);

    // Save content blocks to database with proper display order
    // Also extract <think> tag thinking from content blocks and save as separate thinking_steps
    // Only save if we have tool calls (otherwise content is just the message content)
    let content_data = content_blocks.read().await;
    let has_tool_calls = !tool_calls_map.read().await.is_empty();
    let mut xml_thinking_saved = false;
    if has_tool_calls && !content_data.is_empty() {
        tracing::info!(
            "💾 [agent_streaming] Saving {} content block(s) to database",
            content_data.len()
        );

        for (order, content) in content_data.iter() {
            if content.trim().is_empty() {
                continue;
            }

            // Parse content block for <think> tags
            let parsed = crate::thinking_parser::parse_thinking_content(content);

            // Save extracted thinking as a separate thinking_step
            if let Some(ref thinking) = parsed.thinking_content
                && !thinking.trim().is_empty()
            {
                match state_clone
                    .db
                    .create_thinking_step(CreateThinkingStepRequest {
                        message_id: assistant_message.id.clone(),
                        content: thinking.clone(),
                        source: Some("llm".to_string()),
                        display_order: Some(*order),
                    })
                    .await
                {
                    Ok(_) => {
                        tracing::info!(
                            "✅ [agent_streaming] XML thinking extracted from content block, saved with display_order: {}",
                            order
                        );
                        xml_thinking_saved = true;
                    }
                    Err(e) => {
                        tracing::error!(
                            "❌ [agent_streaming] Failed to save XML thinking step: {}",
                            e
                        );
                    }
                }
            }

            // Save cleaned content (with <think> tags stripped)
            if !parsed.content.trim().is_empty() {
                match state_clone
                    .db
                    .create_content_block(CreateContentBlockRequest {
                        message_id: assistant_message.id.clone(),
                        content: parsed.content,
                        display_order: *order,
                    })
                    .await
                {
                    Ok(block) => {
                        tracing::info!(
                            "✅ [agent_streaming] Content block saved ({}) with display_order: {}",
                            block.id,
                            order
                        );
                    }
                    Err(e) => {
                        tracing::error!("❌ [agent_streaming] Failed to save content block: {}", e);
                    }
                }
            }
        }
    }
    drop(content_data);

    // Fallback: if no API reasoning blocks and no XML thinking was extracted
    // from content blocks, save the combined thinking content (no-tool-call case)
    if reasoning_blocks.read().await.is_empty()
        && !xml_thinking_saved
        && let Some(thinking_content) = response.thinking_content
        && !thinking_content.is_empty()
    {
        match state_clone
            .db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: assistant_message.id.clone(),
                content: thinking_content,
                source: Some("llm".to_string()),
                display_order: Some(0),
            })
            .await
        {
            Ok(_thinking_step) => {
                // ThinkingStep is now directly linked via message_id FK
            }
            Err(e) => {
                tracing::error!("Failed to save thinking step: {}", e);
            }
        }
    }

    tracing::info!(
        "✅ [agent_streaming] Assistant message saved with id: {}",
        assistant_message.id
    );

    // Notify frontend that streaming is complete
    let completion_payload = serde_json::json!({
        "conversation_id": conversation_id_clone,
        "message": assistant_message,
    });
    let _ = app.emit("chat-complete", completion_payload);

    // Remove task from tracking
    {
        let mut tasks = state_clone.generation_tasks.write().await;
        tasks.remove(&conversation_id_clone);
    }
}

/// Result of loading MCP tools: server tools for the agent + mappings for tool name resolution.
struct LoadedMcpTools {
    server_tools: Vec<(Vec<RmcpTool>, Peer<RoleClient>)>,
    /// Maps MCP tool name (e.g. "search") to the DB tool ID of the MCP server that provides it.
    tool_name_to_server_id: HashMap<String, String>,
    /// Maps MCP tool name (e.g. "search") to the user-visible server name (e.g. "github").
    tool_name_to_server_name: HashMap<String, String>,
    /// Maps "server_name/tool_name" key to transport type (used for security scanning).
    tool_name_to_transport: HashMap<String, McpTransportType>,
    /// Server IDs that failed to connect due to auth errors (401/Unauthorized).
    auth_failed_server_ids: Vec<String>,
}

/// Load MCP tools by their tool IDs.
/// Returns one (tools, client) per connected MCP server so tool calls are routed to the correct server.
async fn load_mcp_tools_by_ids(state: &AppState, tool_ids: &[String]) -> Option<LoadedMcpTools> {
    if tool_ids.is_empty() {
        return None;
    }

    tracing::info!("🔌 [mcp] Loading {} MCP server(s) by IDs", tool_ids.len());

    // Get the tool configurations from DB
    let tools = match state.db.get_tools_by_ids(tool_ids).await {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("⚠️ [mcp] Failed to get MCP server configs: {}", e);
            return None;
        }
    };

    // Filter to only enabled MCP tools
    let enabled_tools: Vec<_> = tools
        .into_iter()
        .filter(|t| t.r#type == "mcp" && t.is_enabled)
        .collect();

    if enabled_tools.is_empty() {
        return None;
    }

    // Connect to all enabled MCP servers and collect (tools, client) per server
    let result = match state.mcp_manager.connect_multiple(&enabled_tools).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("⚠️ [mcp] Failed to connect to MCP servers: {}", e);
            return None;
        }
    };

    // Detect auth failures (401/Unauthorized) from connection errors
    let auth_failed_server_ids: Vec<String> = result
        .failures
        .iter()
        .filter(|f| is_auth_error(&f.error))
        .map(|f| f.tool_id.clone())
        .collect();

    if !auth_failed_server_ids.is_empty() {
        tracing::warn!(
            "🔐 [mcp] {} server(s) failed with auth errors: {:?}",
            auth_failed_server_ids.len(),
            auth_failed_server_ids
        );
    }

    if result.connections.is_empty() && auth_failed_server_ids.is_empty() {
        return None;
    }

    let mut tool_name_to_server_id = HashMap::new();
    let mut tool_name_to_server_name = HashMap::new();
    let mut tool_name_to_transport: HashMap<String, McpTransportType> = HashMap::new();
    let mut server_tools = Vec::new();

    for (conn, tools) in result.connections {
        let transport = conn.tool.get_transport_type();
        for t in &tools {
            let key = format!("{}/{}", conn.tool.name, t.name);
            tool_name_to_server_id.insert(key.clone(), conn.tool.id.clone());
            tool_name_to_server_name.insert(key.clone(), conn.tool.name.clone());
            tool_name_to_transport.insert(key, transport);
            // Also insert raw key so non-lazy path (direct rmcp_tools) auth lookup still works
            tool_name_to_server_id.insert(t.name.to_string(), conn.tool.id.clone());
            tool_name_to_server_name.insert(t.name.to_string(), conn.tool.name.clone());
        }
        server_tools.push((tools, conn.client));
    }

    Some(LoadedMcpTools {
        server_tools,
        tool_name_to_server_id,
        tool_name_to_server_name,
        tool_name_to_transport,
        auth_failed_server_ids,
    })
}

/// Build a display-friendly tool name: prefix MCP tools with `mcp__{server_name}__`.
/// Built-in tools are returned as-is.
fn mcp_display_name(original_name: &str, server_name_map: &HashMap<String, String>) -> String {
    match server_name_map.get(original_name) {
        Some(server_name) => {
            let sanitized = sanitize_server_name(server_name);
            format!("mcp__{}__{}", sanitized, original_name)
        }
        None => original_name.to_string(),
    }
}

/// Build display name from a stored tool key (composite "server/tool" in lazy-load, or plain name).
fn mcp_display_name_from_stored(
    stored_key: &str,
    server_name_map: &HashMap<String, String>,
) -> String {
    if let Some((server, tool)) = stored_key.split_once('/') {
        format!("mcp__{}__{}", sanitize_server_name(server), tool)
    } else {
        mcp_display_name(stored_key, server_name_map)
    }
}

/// Sanitize an MCP server name for use in the `mcp__<name>__` prefix.
/// Keeps alphanumeric chars and hyphens; replaces everything else with hyphens.
fn sanitize_server_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    s.trim_matches('-').to_string()
}

/// Check if a tool output looks like an HTTP 401 authentication error.
fn is_auth_error(output: &str) -> bool {
    let lower = output.to_lowercase();
    (lower.contains("401") && (lower.contains("unauthorized") || lower.contains("http")))
        || (lower.contains("unauthorized") && lower.contains("error"))
        || lower.contains("token expired")
        || lower.contains("token has expired")
        || lower.contains("invalid_token")
        || lower.contains("authentication required")
}

/// Map the compile-time OS constant onto the label used in the environment
/// info block (matches `uname -s` style naming for macOS).
fn os_platform_label(os: &str) -> &str {
    match os {
        "macos" => "darwin",
        other => other,
    }
}

/// Build the environment info block appended to the system prompt.
/// `today` is the pre-formatted date string; `working_dir` is only included
/// when explicitly set in conversation settings, along with whether the
/// directory is a git repository.
fn build_env_block(
    provider_type: &str,
    model_id: &str,
    today: &str,
    platform: &str,
    working_dir: Option<&str>,
) -> String {
    let mut env_block = format!(
        "\n\nYou are running on model {provider_type}/{model_id}\n\n## Environment\n\n- Platform: {platform}\n- Today's date: {today}",
    );

    if let Some(working_dir) = working_dir {
        let is_git_repo = std::path::Path::new(working_dir).join(".git").exists();
        env_block.push_str(&format!(
            "\n- Working directory: {working_dir}\n- Is directory a git repo: {}",
            if is_git_repo { "yes" } else { "no" },
        ));
    }

    env_block
}

/// Collect MCP server IDs: enabled tool IDs that are not built-in tools.
fn collect_mcp_server_ids(all_enabled_tool_ids: &[String]) -> Vec<String> {
    all_enabled_tool_ids
        .iter()
        .filter(|id| {
            *id != &BUILTIN_WEB_SEARCH_ID.to_string()
                && *id != &BUILTIN_WEB_FETCH_ID.to_string()
                && *id != &BUILTIN_BASH_ID.to_string()
                && *id != &BUILTIN_KILL_SHELL_ID.to_string()
                && *id != &BUILTIN_READ_ID.to_string()
                && *id != &BUILTIN_EDIT_ID.to_string()
                && *id != &BUILTIN_WRITE_ID.to_string()
                && *id != &BUILTIN_GREP_ID.to_string()
                && *id != &BUILTIN_GLOB_ID.to_string()
        })
        .cloned()
        .collect()
}

/// Resolve an incoming tool call into its (actual tool name, display name,
/// display input), unpacking the `mcp_tool_use` meta-tool envelope.
/// The actual name is the composite `server/tool` key used for auth lookup.
fn resolve_tool_display(
    tool_name: &str,
    tool_input: &str,
    server_name_map: &HashMap<String, String>,
) -> (String, String, String) {
    if tool_name == "mcp_tool_use" {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(tool_input) {
            let server_name = parsed["server"].as_str().unwrap_or("unknown").to_string();
            let real_name = parsed["tool"]
                .as_str()
                .unwrap_or("mcp_tool_use")
                .to_string();
            let inner_args = parsed
                .get("arguments")
                .map(|a| a.to_string())
                .unwrap_or_else(|| "{}".to_string());
            // Store composite key for auth lookup; build display name directly
            let composite_key = format!("{}/{}", server_name, real_name);
            let display = format!("mcp__{}__{}", sanitize_server_name(&server_name), real_name);
            (composite_key, display, inner_args)
        } else {
            let fallback_name = tool_name.to_string();
            let display = mcp_display_name(&fallback_name, server_name_map);
            (fallback_name, display, tool_input.to_string())
        }
    } else {
        let name = tool_name.to_string();
        let display = mcp_display_name(&name, server_name_map);
        (name, display, tool_input.to_string())
    }
}

/// Heuristic duplicate detection for streamed images. The API may re-send
/// the same image with slightly different encoding (e.g. OpenRouter Gemini
/// streams the image once, then echoes a re-encoded copy with the finish
/// chunk). Exact string match catches identical re-sends; size-based
/// comparison catches re-encoded duplicates (typically <1% size diff).
fn is_duplicate_image(images: &[String], data_url: &str) -> bool {
    let new_len = data_url.len();
    images.iter().any(|existing| {
        if existing == data_url {
            return true;
        }
        let existing_len = existing.len();
        let diff = new_len.abs_diff(existing_len);
        diff * 100 < existing_len.max(1) * 2
    })
}

/// Why parsing a generated-image data URL failed.
#[derive(Debug)]
enum ImageDataUrlError {
    MissingPrefix,
    MissingComma,
    Decode(base64::DecodeError),
}

/// Parse a `data:<mime>;base64,<payload>` URL into its MIME type and decoded
/// bytes. The MIME type defaults to `image/png` when the header is empty.
fn parse_image_data_url(data_url: &str) -> Result<(String, Vec<u8>), ImageDataUrlError> {
    let rest = data_url
        .strip_prefix("data:")
        .ok_or(ImageDataUrlError::MissingPrefix)?;
    let (header, base64_data) = rest
        .split_once(",")
        .ok_or(ImageDataUrlError::MissingComma)?;
    let mime_type = header.split(';').next().unwrap_or("image/png").to_string();
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64_data)
        .map_err(ImageDataUrlError::Decode)?;
    Ok((mime_type, bytes))
}

/// Whether the streamed turn produced any data worth persisting.
fn has_any_data(
    final_content: &str,
    has_tool_calls: bool,
    has_reasoning_blocks: bool,
    has_content_blocks: bool,
    has_thinking: bool,
    has_images: bool,
) -> bool {
    !final_content.trim().is_empty()
        || has_tool_calls
        || has_reasoning_blocks
        || has_content_blocks
        || has_thinking
        || has_images
}

/// Derive the persisted status for a tool call from its output and the
/// stream's cancellation state.
fn tool_call_status(tool_output: Option<&String>, was_cancelled: bool) -> &'static str {
    if tool_output.is_some() {
        "success"
    } else if was_cancelled {
        "cancelled"
    } else {
        "pending"
    }
}

/// Format the `<image_attachments>` block appended to the final user
/// message when a text-only model's images are stripped from direct input.
///
/// `images` are (display name, absolute storage path) pairs. The note
/// advertises the `read` tool escape hatch only when tools are available
/// for the turn — a tool suggestion the model cannot act on is noise.
pub(crate) fn format_image_annotations(
    images: &[(String, String)],
    tools_available: bool,
) -> String {
    if images.is_empty() {
        return String::new();
    }
    let note = if tools_available {
        "This model cannot view image pixels directly. Each attached image is preserved at its path; use the read tool on a path (optionally with the question argument to inspect it via the vision model)."
    } else {
        "This model cannot view image pixels directly. The attached images are preserved as files at the listed paths but cannot be inspected in this conversation."
    };
    let mut out = format!("<image_attachments note=\"{note}\">\n");
    for (name, path) in images {
        out.push_str(&format!("<image name=\"{name}\" path=\"{path}\" />\n"));
    }
    out.push_str("</image_attachments>");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Tier 0: already-pure helpers ----

    #[test]
    fn sanitize_server_name_keeps_alnum_and_hyphens() {
        assert_eq!(sanitize_server_name("My Server"), "My-Server");
        assert_eq!(sanitize_server_name("already-clean"), "already-clean");
        assert_eq!(sanitize_server_name("a b_c!d"), "a-b-c-d");
        // Leading/trailing hyphens (from replaced edge chars) are trimmed
        assert_eq!(sanitize_server_name("-edges-"), "edges");
        assert_eq!(sanitize_server_name("  spaced  "), "spaced");
        // Non-ASCII chars are replaced, not passed through
        assert_eq!(sanitize_server_name("café"), "caf");
        assert_eq!(sanitize_server_name("!!!"), "");
        assert_eq!(sanitize_server_name(""), "");
    }

    #[test]
    fn mcp_display_name_prefixes_mapped_tools() {
        let mut map = HashMap::new();
        map.insert("search".to_string(), "My Server!".to_string());
        assert_eq!(mcp_display_name("search", &map), "mcp__My-Server__search");
        // Unmapped (built-in) tools pass through unchanged
        assert_eq!(mcp_display_name("read", &map), "read");
    }

    #[test]
    fn mcp_display_name_from_stored_handles_composite_and_plain_keys() {
        let mut map = HashMap::new();
        map.insert("search".to_string(), "My Server".to_string());

        // Composite "server/tool" keys bypass the map entirely
        assert_eq!(
            mcp_display_name_from_stored("fs/read_file", &map),
            "mcp__fs__read_file"
        );
        // Server part of a composite key is sanitized too
        assert_eq!(
            mcp_display_name_from_stored("My Server/tool", &map),
            "mcp__My-Server__tool"
        );
        // Only the first '/' splits: the rest stays in the tool name
        assert_eq!(mcp_display_name_from_stored("a/b/c", &map), "mcp__a__b/c");

        // Plain keys fall back to the map lookup
        assert_eq!(
            mcp_display_name_from_stored("search", &map),
            "mcp__My-Server__search"
        );
        assert_eq!(mcp_display_name_from_stored("read", &map), "read");
    }

    #[test]
    fn is_auth_error_matches_each_disjunct() {
        // 401 + unauthorized/http
        assert!(is_auth_error("HTTP 401 Unauthorized"));
        assert!(is_auth_error("request failed with 401 over http"));
        // 401 alone is not enough
        assert!(!is_auth_error("401"));
        // http alone (e.g. 500) is not enough
        assert!(!is_auth_error("http 500 internal server error"));

        // unauthorized + error
        assert!(is_auth_error("Unauthorized error"));
        // permission-style errors are not auth errors
        assert!(!is_auth_error("permission error"));

        // token variants (case-insensitive)
        assert!(is_auth_error("Token Expired"));
        assert!(is_auth_error("the token has expired, please log in"));
        assert!(is_auth_error("invalid_token"));
        assert!(is_auth_error("Authentication required"));

        assert!(!is_auth_error("everything went fine"));
        assert!(!is_auth_error(""));
    }

    #[test]
    fn bash_temp_file_guard_drop_removes_tracked_files() {
        let files: TempFileList = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut paths = Vec::new();
        for i in 0..2 {
            let path = std::env::temp_dir().join(format!(
                "chatshell-guard-test-{}-{}.tmp",
                std::process::id(),
                i
            ));
            std::fs::write(&path, b"scratch").unwrap();
            assert!(path.exists());
            paths.push(path.clone());
            files.lock().unwrap().push(path);
        }

        {
            let guard = BashTempFileGuard {
                files: files.clone(),
            };
            // Files must still exist while the guard is alive
            assert!(paths.iter().all(|p| p.exists()));
            drop(guard);
        }

        assert!(paths.iter().all(|p| !p.exists()));
        assert!(files.lock().unwrap().is_empty());
    }

    // ---- Tier 1: extracted pure logic ----

    #[test]
    fn os_platform_label_maps_macos_to_darwin() {
        assert_eq!(os_platform_label("macos"), "darwin");
        assert_eq!(os_platform_label("linux"), "linux");
        assert_eq!(os_platform_label("windows"), "windows");
    }

    #[test]
    fn build_env_block_formats_model_platform_and_date() {
        let block = build_env_block("anthropic", "claude-4", "Mon Oct 20 2026", "darwin", None);
        assert_eq!(
            block,
            "\n\nYou are running on model anthropic/claude-4\n\n## Environment\n\n- Platform: darwin\n- Today's date: Mon Oct 20 2026"
        );
        assert!(!block.contains("Working directory"));
    }

    #[test]
    fn build_env_block_reports_git_repo_status_of_working_dir() {
        let dir = tempfile::tempdir().unwrap();
        let plain = dir.path().join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();

        let with_repo = build_env_block("p", "m", "today", "linux", repo.to_str());
        assert!(with_repo.contains(&format!("\n- Working directory: {}", repo.display())));
        assert!(with_repo.contains("- Is directory a git repo: yes"));

        let without_repo = build_env_block("p", "m", "today", "linux", plain.to_str());
        assert!(without_repo.contains(&format!("\n- Working directory: {}", plain.display())));
        assert!(without_repo.contains("- Is directory a git repo: no"));
    }

    #[test]
    fn collect_mcp_server_ids_filters_builtin_tools() {
        let ids = vec![
            BUILTIN_READ_ID.to_string(),
            "mcp-filesystem".to_string(),
            BUILTIN_BASH_ID.to_string(),
            BUILTIN_WEB_SEARCH_ID.to_string(),
            BUILTIN_WEB_FETCH_ID.to_string(),
            BUILTIN_KILL_SHELL_ID.to_string(),
            BUILTIN_EDIT_ID.to_string(),
            BUILTIN_WRITE_ID.to_string(),
            BUILTIN_GREP_ID.to_string(),
            BUILTIN_GLOB_ID.to_string(),
            "mcp-github".to_string(),
        ];
        assert_eq!(
            collect_mcp_server_ids(&ids),
            vec!["mcp-filesystem".to_string(), "mcp-github".to_string()]
        );
        assert!(collect_mcp_server_ids(&[]).is_empty());
    }

    #[test]
    fn resolve_tool_display_unwraps_mcp_meta_tool_envelope() {
        let map = HashMap::new();
        let input = r#"{"server":"My Server!","tool":"search","arguments":{"q":"hi"}}"#;
        let (actual, display, args) = resolve_tool_display("mcp_tool_use", input, &map);
        assert_eq!(actual, "My Server!/search");
        assert_eq!(display, "mcp__My-Server__search");
        assert_eq!(args, r#"{"q":"hi"}"#);
    }

    #[test]
    fn resolve_tool_display_defaults_missing_envelope_fields() {
        let map = HashMap::new();
        // Missing server/tool fall back to placeholders; missing arguments -> "{}"
        let (actual, display, args) = resolve_tool_display("mcp_tool_use", r#"{}"#, &map);
        assert_eq!(actual, "unknown/mcp_tool_use");
        assert_eq!(display, "mcp__unknown__mcp_tool_use");
        assert_eq!(args, "{}");

        // Non-string server field also falls back to the placeholder
        let (actual, _, args) =
            resolve_tool_display("mcp_tool_use", r#"{"server":42,"tool":"t"}"#, &map);
        assert_eq!(actual, "unknown/t");
        assert_eq!(args, "{}");
    }

    #[test]
    fn resolve_tool_display_falls_back_on_malformed_envelope_json() {
        let mut map = HashMap::new();
        map.insert("mcp_tool_use".to_string(), "Fallback Server".to_string());

        let (actual, display, input) = resolve_tool_display("mcp_tool_use", "{not json", &map);
        assert_eq!(actual, "mcp_tool_use");
        assert_eq!(display, "mcp__Fallback-Server__mcp_tool_use");
        assert_eq!(input, "{not json");
    }

    #[test]
    fn resolve_tool_display_passes_non_mcp_tools_through() {
        let mut map = HashMap::new();
        map.insert("read".to_string(), "File Server".to_string());

        // Mapped MCP-routed tool gets the mcp__ prefix
        let (actual, display, input) = resolve_tool_display("read", "{\"path\":\"/x\"}", &map);
        assert_eq!(actual, "read");
        assert_eq!(display, "mcp__File-Server__read");
        assert_eq!(input, "{\"path\":\"/x\"}");

        // Unmapped built-in tool is unchanged
        let (actual, display, input) = resolve_tool_display("bash", "ls", &map);
        assert_eq!(actual, "bash");
        assert_eq!(display, "bash");
        assert_eq!(input, "ls");
    }

    #[test]
    fn is_duplicate_image_matches_exact_and_near_size_copies() {
        let existing = vec!["data:image/png;base64,AAAA".to_string()];
        // Exact re-send
        assert!(is_duplicate_image(&existing, "data:image/png;base64,AAAA"));

        // No history at all
        assert!(!is_duplicate_image(&[], "data:image/png;base64,AAAA"));

        // Re-encoded copy within 2% of the existing length (995 vs 1000 bytes)
        let a: String = "x".repeat(1000);
        let b: String = "x".repeat(995);
        assert!(is_duplicate_image(&[a.clone()], &b));

        // Strictly past the 2% threshold (979 vs 1000 bytes) is NOT a duplicate
        let c: String = "x".repeat(979);
        assert!(!is_duplicate_image(&[a.clone()], &c));

        // Exactly 2% (diff*100 == len*2) fails the strict < and is not a duplicate
        let d: String = "x".repeat(980);
        assert!(!is_duplicate_image(&[a], &d));

        // Distinct images of clearly different sizes pass
        let big: String = "y".repeat(5000);
        assert!(!is_duplicate_image(&[big], &"z".repeat(100)));

        // An empty stored entry never swallows non-empty images
        assert!(!is_duplicate_image(&[String::new()], "img"));
    }

    #[test]
    fn parse_image_data_url_decodes_valid_urls() {
        let (mime, bytes) = parse_image_data_url("data:image/png;base64,aGVsbG8=").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, b"hello");

        // The part before the first ';' is the MIME type
        let (mime, bytes) = parse_image_data_url("data:image/jpeg;base64,eA==").unwrap();
        assert_eq!(mime, "image/jpeg");
        assert_eq!(bytes, b"x");

        // A header without parameters still parses
        let (mime, _) = parse_image_data_url("data:image/gif,R0lGODlh").unwrap();
        assert_eq!(mime, "image/gif");
    }

    #[test]
    fn parse_image_data_url_rejects_malformed_urls() {
        // Not a data URL at all
        assert!(matches!(
            parse_image_data_url("https://example.com/img.png"),
            Err(ImageDataUrlError::MissingPrefix)
        ));
        // Missing comma separating header from payload
        assert!(matches!(
            parse_image_data_url("data:image/png;base64"),
            Err(ImageDataUrlError::MissingComma)
        ));
        // Invalid base64 payload
        assert!(matches!(
            parse_image_data_url("data:image/png;base64,!!!not-base64!!!"),
            Err(ImageDataUrlError::Decode(_))
        ));
    }

    #[test]
    fn has_any_data_requires_non_whitespace_content_or_any_stream_artifact() {
        let nothing = |content: &str| has_any_data(content, false, false, false, false, false);
        // Empty and whitespace-only content with no artifacts
        assert!(!nothing(""));
        assert!(!nothing("   \n\t  "));

        // Non-whitespace content alone is enough
        assert!(nothing("hello"));
        assert!(nothing(" x "));

        // Whitespace content plus any single artifact
        assert!(has_any_data("  ", true, false, false, false, false));
        assert!(has_any_data("  ", false, true, false, false, false));
        assert!(has_any_data("  ", false, false, true, false, false));
        assert!(has_any_data("  ", false, false, false, true, false));
        assert!(has_any_data("  ", false, false, false, false, true));
    }

    #[test]
    fn tool_call_status_prefers_output_then_cancellation() {
        let output = Some("done".to_string());
        assert_eq!(tool_call_status(output.as_ref(), true), "success");
        assert_eq!(tool_call_status(output.as_ref(), false), "success");
        assert_eq!(tool_call_status(None, true), "cancelled");
        assert_eq!(tool_call_status(None, false), "pending");
    }

    #[test]
    fn empty_input_renders_nothing() {
        assert_eq!(format_image_annotations(&[], true), "");
        assert_eq!(format_image_annotations(&[], false), "");
    }

    #[test]
    fn lists_every_image_with_absolute_path() {
        let images = vec![
            ("shot.png".to_string(), "/tmp/a/files/abc.png".to_string()),
            ("photo.jpg".to_string(), "/tmp/a/files/def.jpg".to_string()),
        ];
        let out = format_image_annotations(&images, true);
        assert!(out.starts_with("<image_attachments note=\""));
        assert!(out.ends_with("</image_attachments>"));
        assert!(out.contains("<image name=\"shot.png\" path=\"/tmp/a/files/abc.png\" />"));
        assert!(out.contains("<image name=\"photo.jpg\" path=\"/tmp/a/files/def.jpg\" />"));
    }

    #[test]
    fn tools_available_controls_read_guidance() {
        let images = vec![("a.png".to_string(), "/x/a.png".to_string())];
        let with_tools = format_image_annotations(&images, true);
        let without_tools = format_image_annotations(&images, false);
        assert!(with_tools.contains("use the read tool"));
        assert!(!without_tools.contains("use the read tool"));
        assert!(without_tools.contains("cannot be inspected"));
    }

    // ---- run_agent_stream: full-pipeline integration over a mock runtime ----

    use crate::db::Database;
    use crate::llm::ImageData;
    use crate::llm::capabilities::CapabilitiesCache;
    use crate::llm::tools::BashSessionManager;
    use crate::mcp::McpConnectionManager;
    use crate::models::CreateConversationRequest;
    use std::collections::VecDeque;
    use std::convert::Infallible;
    use tauri::Listener;
    use tokio_util::sync::CancellationToken as TestCancellationToken;

    use rig::agent::AgentBuilder;
    use rig::completion::{
        CompletionError, CompletionModel, CompletionRequest, CompletionResponse, Usage,
    };
    use rig::message::{ReasoningContent, UserContent};
    use rig::streaming::{
        RawStreamingChoice, RawStreamingToolCall, StreamFinal, StreamPartId,
        StreamingCompletionResponse, WireId,
    };
    use rig::tool::{Tool, ToolContext};
    use serde::Deserialize;
    use serde_json::json;

    /// Every event `run_agent_stream` can emit (the streaming half of the
    /// frontend wire contract; the other events come from sibling modules).
    const STREAM_EVENTS: [&str; 10] = [
        "chat-stream",
        "reasoning-started",
        "chat-stream-reasoning",
        "tool-call-started",
        "tool-call-completed",
        "chat-stream-image",
        "mcp-auth-required",
        "chat-error",
        "chat-warning",
        "chat-complete",
    ];

    type MockEvent = Result<RawStreamingChoice, CompletionError>;

    fn text_event(text: &str) -> MockEvent {
        Ok(RawStreamingChoice::Message(text.to_string()))
    }

    fn reasoning_delta_event(id: &str, text: &str) -> MockEvent {
        Ok(RawStreamingChoice::ReasoningDelta {
            id: StreamPartId::wire(id),
            provider_id: None,
            reasoning: text.to_string(),
        })
    }

    fn tool_call_event(call_id: &str, name: &str, arguments: serde_json::Value) -> MockEvent {
        Ok(RawStreamingChoice::ToolCall(RawStreamingToolCall {
            id: StreamPartId::wire(call_id),
            tool_id: WireId::new(call_id),
            internal_call_id: format!("internal-{call_id}"),
            call_id: Some(call_id.to_string()),
            name: name.to_string(),
            arguments,
            signature: None,
            additional_params: None,
        }))
    }

    fn final_event() -> MockEvent {
        Ok(RawStreamingChoice::FinalResponse(StreamFinal::new(
            "mock",
            Usage::new(),
        )))
    }

    fn error_event(message: &str) -> MockEvent {
        Err(CompletionError::ProviderError(message.to_string()))
    }

    /// Deterministic offline completion model: each call pops the next
    /// scripted turn of raw provider events and records the request so
    /// tests can inspect what the pipeline sent.
    struct ScriptedModel {
        turns: std::sync::Arc<std::sync::Mutex<VecDeque<Vec<MockEvent>>>>,
        requests: std::sync::Arc<std::sync::Mutex<Vec<CompletionRequest>>>,
    }

    impl CompletionModel for ScriptedModel {
        async fn completion(
            &self,
            _request: CompletionRequest,
        ) -> Result<CompletionResponse, CompletionError> {
            Err(CompletionError::ResponseError(
                "non-streaming completion is not scripted".to_string(),
            ))
        }

        async fn stream(
            &self,
            request: CompletionRequest,
        ) -> Result<StreamingCompletionResponse, CompletionError> {
            self.requests.lock().unwrap().push(request);
            let events = self
                .turns
                .lock()
                .unwrap()
                .pop_front()
                .expect("scripted model was called more times than scripted");
            Ok(StreamingCompletionResponse::stream(
                "mock",
                Box::pin(futures::stream::iter(events)),
            ))
        }
    }

    fn scripted_agent(
        turns: Vec<Vec<MockEvent>>,
    ) -> (
        Agent,
        std::sync::Arc<std::sync::Mutex<Vec<CompletionRequest>>>,
    ) {
        let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let model = ScriptedModel {
            turns: std::sync::Arc::new(std::sync::Mutex::new(turns.into())),
            requests: requests.clone(),
        };
        (AgentBuilder::new(model).build(), requests)
    }

    fn scripted_agent_with_tool<T: Tool + 'static>(
        turns: Vec<Vec<MockEvent>>,
        tool: T,
    ) -> (
        Agent,
        std::sync::Arc<std::sync::Mutex<Vec<CompletionRequest>>>,
    ) {
        let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let model = ScriptedModel {
            turns: std::sync::Arc::new(std::sync::Mutex::new(turns.into())),
            requests: requests.clone(),
        };
        (AgentBuilder::new(model).tool(tool).build(), requests)
    }

    #[derive(Deserialize)]
    struct EchoArgs {
        text: String,
    }

    struct EchoTool;

    impl Tool for EchoTool {
        const NAME: &'static str = "echo";
        type Args = EchoArgs;
        type Output = String;
        type Error = Infallible;

        fn description(&self) -> String {
            "Echo the text argument back".to_string()
        }

        fn parameters(&self) -> serde_json::Value {
            json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            })
        }

        async fn call(
            &self,
            _context: &mut ToolContext,
            args: EchoArgs,
        ) -> Result<String, Infallible> {
            Ok(format!("echo: {}", args.text))
        }
    }

    /// Cancels the generation token when invoked, then echoes — simulates a
    /// user stop arriving mid-tool-execution.
    struct CancellingEchoTool {
        cancel: TestCancellationToken,
    }

    impl Tool for CancellingEchoTool {
        const NAME: &'static str = "cancel_echo";
        type Args = EchoArgs;
        type Output = String;
        type Error = Infallible;

        fn description(&self) -> String {
            "Echo and cancel".to_string()
        }

        fn parameters(&self) -> serde_json::Value {
            json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            })
        }

        async fn call(
            &self,
            _context: &mut ToolContext,
            args: EchoArgs,
        ) -> Result<String, Infallible> {
            self.cancel.cancel();
            Ok(format!("echo: {}", args.text))
        }
    }

    /// AppState backed by a throwaway SQLite database plus a conversation
    /// row (messages carry a conversation FK).
    async fn pipeline_state() -> (AppState, String, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        let conv = db
            .create_conversation(CreateConversationRequest { title: "t".into() })
            .await
            .unwrap();

        let state = AppState {
            db,
            generation_tasks: Arc::new(RwLock::new(HashMap::new())),
            mcp_manager: Arc::new(McpConnectionManager::new()),
            pending_oauth: Arc::new(RwLock::new(HashMap::new())),
            bash_session_manager: Arc::new(BashSessionManager::new()),
            capabilities_cache: Arc::new(CapabilitiesCache::new()),
            sync_engine: Arc::new(std::sync::Mutex::new(None)),
        };
        (state, conv.id.to_string(), dir)
    }

    #[derive(Debug, Clone)]
    struct RecordedEvent {
        name: String,
        payload: serde_json::Value,
    }

    fn record_events(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> std::sync::Arc<std::sync::Mutex<Vec<RecordedEvent>>> {
        let log: std::sync::Arc<std::sync::Mutex<Vec<RecordedEvent>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        for name in STREAM_EVENTS {
            let log = log.clone();
            let recorded_name = name.to_string();
            app.listen_any(name, move |event| {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    log.lock().unwrap().push(RecordedEvent {
                        name: recorded_name.clone(),
                        payload,
                    });
                }
            });
        }
        log
    }

    fn user_message(content: &str) -> ChatMessage {
        ChatMessage {
            role: "user".into(),
            content: content.into(),
            images: vec![],
            files: vec![],
            tool_calls: vec![],
            tool_call_id: None,
            tool_result_call_id: None,
            reasoning_content: None,
        }
    }

    fn base_ctx(conversation_id: &str) -> AgentStreamContext {
        AgentStreamContext {
            conversation_id: conversation_id.to_string(),
            content: "hi".into(),
            system_prompt_provided: false,
            model_id: "test-model".into(),
            provider_type: "test".into(),
            model_db_id: None,
            assistant_db_id: None,
            disable_tools: false,
            stored_images: vec![],
            supports_vision: None,
            mcp_tool_name_to_server_id: Arc::new(HashMap::new()),
            mcp_tool_name_to_server_name: Arc::new(HashMap::new()),
        }
    }

    async fn run_pipeline(
        app: &tauri::App<tauri::test::MockRuntime>,
        state: &AppState,
        agent: Agent,
        chat_messages: Vec<ChatMessage>,
        cancel_token: TestCancellationToken,
        ctx: AgentStreamContext,
    ) {
        state
            .generation_tasks
            .write()
            .await
            .insert(ctx.conversation_id.clone(), cancel_token.clone());
        run_agent_stream(app.handle(), state, agent, chat_messages, cancel_token, ctx).await;
    }

    fn names(log: &[RecordedEvent]) -> Vec<String> {
        log.iter().map(|e| e.name.clone()).collect()
    }

    #[tokio::test]
    async fn text_turn_streams_saves_message_and_completes() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let (agent, _requests) =
            scripted_agent(vec![vec![text_event("Hello world"), final_event()]]);

        run_pipeline(
            &app,
            &state,
            agent,
            vec![user_message("hi")],
            TestCancellationToken::new(),
            base_ctx(&conv_id),
        )
        .await;

        let log = log.lock().unwrap();
        assert_eq!(
            names(&log),
            vec!["chat-stream", "chat-complete"],
            "exact event sequence for a text-only turn"
        );
        assert_eq!(log[0].payload["content"], "Hello world");
        assert_eq!(log[0].payload["conversation_id"], conv_id);

        let complete = &log[1].payload;
        assert_eq!(complete["message"]["content"], "Hello world");
        assert_eq!(complete["message"]["sender_type"], "assistant");
        let message_id = complete["message"]["id"].as_str().unwrap().to_string();
        assert!(
            state
                .db
                .get_thinking_steps_by_message(&message_id)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            state
                .db
                .get_tool_calls_by_message(&message_id)
                .await
                .unwrap()
                .is_empty()
        );
        // Content blocks are only persisted when tool calls exist.
        assert!(
            state
                .db
                .get_content_blocks_by_message(&message_id)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(state.generation_tasks.read().await.is_empty());
    }

    #[tokio::test]
    async fn reasoning_turn_saves_thinking_step_before_answer() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let (agent, _requests) = scripted_agent(vec![vec![
            reasoning_delta_event("r1", "pondering deeply"),
            text_event("the answer"),
            final_event(),
        ]]);

        run_pipeline(
            &app,
            &state,
            agent,
            vec![user_message("hi")],
            TestCancellationToken::new(),
            base_ctx(&conv_id),
        )
        .await;

        let log = log.lock().unwrap();
        assert_eq!(
            names(&log),
            vec![
                "reasoning-started",
                "chat-stream-reasoning",
                "chat-stream",
                "chat-complete"
            ]
        );
        assert_eq!(log[1].payload["content"], "pondering deeply");

        let message_id = log[3].payload["message"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let thinking = state
            .db
            .get_thinking_steps_by_message(&message_id)
            .await
            .unwrap();
        assert_eq!(thinking.len(), 1);
        assert_eq!(thinking[0].content, "pondering deeply");
        assert_eq!(thinking[0].source, "llm");
        assert_eq!(thinking[0].display_order, 0);
    }

    #[tokio::test]
    async fn tool_turn_saves_tool_call_and_content_block_in_order() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let (agent, _requests) = scripted_agent_with_tool(
            vec![
                vec![
                    tool_call_event("c1", "echo", json!({ "text": "hi" })),
                    final_event(),
                ],
                vec![text_event("done"), final_event()],
            ],
            EchoTool,
        );

        run_pipeline(
            &app,
            &state,
            agent,
            vec![user_message("hi")],
            TestCancellationToken::new(),
            base_ctx(&conv_id),
        )
        .await;

        let log = log.lock().unwrap();
        let sequence = names(&log);
        assert_eq!(sequence[0], "tool-call-started");
        assert_eq!(sequence[1], "tool-call-completed");
        assert_eq!(sequence[2], "chat-stream");
        assert_eq!(sequence[3], "chat-complete");
        assert_eq!(log[0].payload["tool_name"], "echo");
        assert!(
            log[0].payload["tool_input"]
                .as_str()
                .unwrap()
                .contains("hi")
        );
        assert_eq!(log[1].payload["tool_output"], "echo: hi");
        // Wire contract: exact snake_case payload keys.
        // JSON object key order is not a wire contract; compare as a set.
        let mut started_keys: Vec<&str> = log[0]
            .payload
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        started_keys.sort_unstable();
        assert_eq!(
            started_keys,
            ["conversation_id", "tool_call_id", "tool_input", "tool_name"]
        );

        let message_id = log[3].payload["message"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let tool_calls = state
            .db
            .get_tool_calls_by_message(&message_id)
            .await
            .unwrap();
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].tool_name, "echo");
        assert_eq!(tool_calls[0].status, "success");
        assert_eq!(tool_calls[0].tool_output.as_deref(), Some("echo: hi"));
        assert_eq!(tool_calls[0].display_order, 0);

        // Content blocks exist only because the turn had tool calls.
        let blocks = state
            .db
            .get_content_blocks_by_message(&message_id)
            .await
            .unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].content, "done");
        assert!(blocks[0].display_order >= 1);
    }

    #[tokio::test]
    async fn think_tags_in_content_blocks_split_into_thinking_steps() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let (agent, _requests) = scripted_agent_with_tool(
            vec![
                vec![
                    tool_call_event("c1", "echo", json!({ "text": "x" })),
                    final_event(),
                ],
                vec![
                    text_event("<think>secret reasoning</think>visible answer"),
                    final_event(),
                ],
            ],
            EchoTool,
        );

        run_pipeline(
            &app,
            &state,
            agent,
            vec![user_message("hi")],
            TestCancellationToken::new(),
            base_ctx(&conv_id),
        )
        .await;

        let log = log.lock().unwrap();
        let message_id = log.last().unwrap().payload["message"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let blocks = state
            .db
            .get_content_blocks_by_message(&message_id)
            .await
            .unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].content.trim(), "visible answer");

        // The <think> payload becomes its own thinking step.
        let thinking = state
            .db
            .get_thinking_steps_by_message(&message_id)
            .await
            .unwrap();
        assert!(
            thinking
                .iter()
                .any(|t| t.content.contains("secret reasoning"))
        );
    }

    #[tokio::test]
    async fn empty_response_emits_chat_error_and_clears_task() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let (agent, _requests) = scripted_agent(vec![vec![final_event()]]);

        run_pipeline(
            &app,
            &state,
            agent,
            vec![user_message("hi")],
            TestCancellationToken::new(),
            base_ctx(&conv_id),
        )
        .await;

        let log = log.lock().unwrap();
        assert_eq!(names(&log), vec!["chat-error"]);
        assert_eq!(log[0].payload["error"], "Model returned empty response");
        assert!(state.generation_tasks.read().await.is_empty());
        assert!(
            state
                .db
                .list_messages_by_conversation(&conv_id, None, None)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn stream_error_emits_chat_error_and_clears_task() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let (agent, _requests) = scripted_agent(vec![vec![error_event("provider exploded")]]);

        run_pipeline(
            &app,
            &state,
            agent,
            vec![user_message("hi")],
            TestCancellationToken::new(),
            base_ctx(&conv_id),
        )
        .await;

        let log = log.lock().unwrap();
        assert_eq!(names(&log), vec!["chat-error"]);
        assert!(
            log[0].payload["error"]
                .as_str()
                .unwrap()
                .contains("provider exploded")
        );
        assert!(state.generation_tasks.read().await.is_empty());
    }

    #[tokio::test]
    async fn pre_cancelled_token_completes_with_null_message() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let (agent, _requests) =
            scripted_agent(vec![vec![text_event("never seen"), final_event()]]);
        let cancel = TestCancellationToken::new();
        cancel.cancel();

        run_pipeline(
            &app,
            &state,
            agent,
            vec![user_message("hi")],
            cancel,
            base_ctx(&conv_id),
        )
        .await;

        let log = log.lock().unwrap();
        assert_eq!(names(&log), vec!["chat-complete"]);
        assert_eq!(log[0].payload["message"], serde_json::Value::Null);
        assert_eq!(log[0].payload["cancelled"], true);
        assert!(
            state
                .db
                .list_messages_by_conversation(&conv_id, None, None)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn mid_stream_cancel_saves_partial_content_and_cancels_tool() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let cancel = TestCancellationToken::new();
        let (agent, _requests) = scripted_agent_with_tool(
            vec![
                vec![
                    text_event("before "),
                    tool_call_event("c1", "cancel_echo", json!({ "text": "x" })),
                    final_event(),
                ],
                // Scripted but never consumed: cancellation breaks the loop
                // before the follow-up model call.
                vec![text_event("after"), final_event()],
            ],
            CancellingEchoTool {
                cancel: cancel.clone(),
            },
        );

        run_pipeline(
            &app,
            &state,
            agent,
            vec![user_message("hi")],
            cancel,
            base_ctx(&conv_id),
        )
        .await;

        let log = log.lock().unwrap();
        let sequence = names(&log);
        assert!(sequence.contains(&"chat-stream".to_string()));
        assert!(sequence.contains(&"tool-call-started".to_string()));
        // Cancellation suppresses the completion event for the tool.
        assert!(!sequence.contains(&"tool-call-completed".to_string()));
        assert_eq!(*sequence.last().unwrap(), "chat-complete");

        let message_id = log.last().unwrap().payload["message"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let messages = state
            .db
            .list_messages_by_conversation(&conv_id, None, None)
            .await
            .unwrap();
        assert_eq!(messages.len(), 1);
        // The thinking parser trims trailing whitespace off streamed content.
        assert_eq!(messages[0].content, "before");

        let tool_calls = state
            .db
            .get_tool_calls_by_message(&message_id)
            .await
            .unwrap();
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].status, "cancelled");
        assert!(tool_calls[0].tool_output.is_none());
    }

    #[tokio::test]
    async fn vision_off_warns_and_strips_images_from_the_prompt() {
        let app = tauri::test::mock_app();
        let log = record_events(&app);
        let (state, conv_id, _dir) = pipeline_state().await;
        let (agent, requests) = scripted_agent(vec![vec![text_event("described"), final_event()]]);

        let mut message = user_message("describe this");
        message.images.push(ImageData {
            base64: "aGk=".into(),
            media_type: "image/png".into(),
        });
        let mut ctx = base_ctx(&conv_id);
        ctx.supports_vision = Some(false);

        run_pipeline(
            &app,
            &state,
            agent,
            vec![message],
            TestCancellationToken::new(),
            ctx,
        )
        .await;

        let log = log.lock().unwrap();
        let warning = log
            .iter()
            .find(|e| e.name == "chat-warning")
            .expect("chat-warning emitted");
        assert_eq!(warning.payload["warning"], "model_no_vision");
        assert_eq!(warning.payload["images"], 1);
        assert_eq!(warning.payload["annotated"], false);

        // The request sent to the (scripted) model carries no image content.
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let image_count = requests[0]
            .chat_history
            .iter()
            .map(|m| match m {
                RigMessage::User { content } => content
                    .iter()
                    .filter(|item| matches!(item, UserContent::Image(_)))
                    .count(),
                _ => 0,
            })
            .sum::<usize>();
        assert_eq!(image_count, 0);
    }
}
