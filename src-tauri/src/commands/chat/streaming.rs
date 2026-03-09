//! Agent-based streaming for LLM responses

use super::super::AppState;
use crate::llm::agent_builder::{
    AgentConfig, build_assistant_message, build_user_message, create_provider_agent,
    stream_chat_with_agent,
};
use crate::llm::tools::bash::{BashTool, TempFileList};
use crate::llm::tools::{LoadMcpSchemaTool, LoadSkillTool, McpCallTool};
use crate::llm::{ChatMessage, ChatResponse, StreamChunkType};
use crate::mcp::sync_tool_definitions;
use crate::models::{
    CreateContentBlockRequest, CreateFileAttachmentRequest, CreateMessageRequest,
    CreateThinkingStepRequest, CreateToolCallRequest, ModelParameters,
};
use rig::completion::Message as RigMessage;
use rmcp::RoleClient;
use rmcp::model::Tool as McpTool;
use rmcp::service::Peer;
use std::collections::HashMap;
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

/// MCP tool count threshold: above this, use lazy loading via file-based discovery
/// instead of injecting all tool schemas into every API call.
const MCP_LAZY_LOAD_THRESHOLD: usize = 8;

/// RAII guard that deletes tracked bash temp files when the streaming task exits
/// (via any path: success, error, or cancellation).
struct BashTempFileGuard {
    files: TempFileList,
}

impl Drop for BashTempFileGuard {
    fn drop(&mut self) {
        BashTool::cleanup_temp_files(&self.files);
    }
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

    // Load conversation-level tool overrides (additive)
    let conv_settings = state_clone
        .db
        .get_conversation_settings(&conversation_id_clone)
        .await
        .ok();

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

    // Append environment info block to system prompt
    {
        use chrono::Local;

        let today = Local::now().format("%a %b %d %Y").to_string();
        let platform = match std::env::consts::OS {
            "macos" => "darwin",
            other => other,
        };

        let mut env_block = format!(
            "\n\nYou are running on model {provider_type}/{model_id}\n\n## Environment\n\n- Platform: {platform}\n- Today's date: {today}",
        );

        // Only include working directory info when explicitly set in conversation settings
        if let Some(working_dir) = conv_settings.as_ref().and_then(|s| s.working_directory.as_deref()) {
            let is_git_repo = std::path::Path::new(working_dir).join(".git").exists();
            env_block.push_str(&format!(
                "\n- Working directory: {working_dir}\n- Is directory a git repo: {}",
                if is_git_repo { "yes" } else { "no" },
            ));
        }

        effective_system_prompt.push_str(&env_block);
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

    // Build skill catalog and inject into system prompt (lazy-load approach)
    if !skill_entries.is_empty() {
        let mut skill_name_to_path: HashMap<String, String> = HashMap::new();
        for entry in &skill_entries {
            skill_name_to_path.insert(entry.name.clone(), entry.path.clone());
        }
        config = config.with_load_skill_tool(LoadSkillTool::new(skill_name_to_path));

        effective_system_prompt.push_str("\n\n## Available Skills\n\n");
        effective_system_prompt.push_str(
            "When a task matches one of the skills below, use the `load_skill` tool to load \
             its full instructions before proceeding.\n\n",
        );
        for entry in &skill_entries {
            let desc = entry.description.as_deref().unwrap_or("No description");
            effective_system_prompt.push_str(&format!("- **{}** - {}\n", entry.name, desc));
        }
    }

    // NOTE: effective_system_prompt is set on config later, after the MCP block
    // may append the MCP tool catalog to it.

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
        tracing::info!("🔍 [agent_streaming] Enabling web_search tool");
        config = config.with_web_search();
    }
    if web_fetch_enabled {
        tracing::info!("🌐 [agent_streaming] Enabling web_fetch tool");
        config = config.with_web_fetch();
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

        let session = state_clone
            .bash_session_manager
            .get_or_create(&conversation_id_clone);
        config = config.with_bash_session(session);
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

    // Collect MCP server IDs (non-builtin tools)
    let mcp_server_ids: Vec<String> = all_enabled_tool_ids
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
        .collect();

    // Load MCP tools from enabled servers
    let (mcp_tool_name_to_server_id, mcp_tool_name_to_server_name): (
        Arc<HashMap<String, String>>,
        Arc<HashMap<String, String>>,
    ) = if !mcp_server_ids.is_empty() {
        let loaded = load_mcp_tools_by_ids(&state_clone, &mcp_server_ids).await;
        if let Some(loaded) = loaded {
            // Emit mcp-auth-required for servers that failed with auth errors
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

                if total > MCP_LAZY_LOAD_THRESHOLD {
                    // Lazy-load path: sync definitions to files, inject catalog
                    // into system prompt, and use McpCallTool meta-tool.
                    tracing::info!(
                        "📄 [agent_streaming] {} tools > threshold {}, using lazy loading",
                        total,
                        MCP_LAZY_LOAD_THRESHOLD
                    );

                    let mcp_tools_dir = app
                        .path()
                        .app_cache_dir()
                        .map(|d| d.join("mcp-tools"))
                        .unwrap_or_else(|_| std::env::temp_dir().join("chatshell-mcp-tools"));
                    if let Err(e) = std::fs::create_dir_all(&mcp_tools_dir) {
                        tracing::warn!(
                            "⚠️ [agent_streaming] Failed to create mcp-tools dir: {}",
                            e
                        );
                    }

                    // Sync tool definitions to files (for debugging) and build in-memory schema map + catalog
                    let mut mcp_catalog = String::from("\n\n## Available MCP Tools\n\n");
                    mcp_catalog.push_str(
                        "When calling `load_mcp_schema` or `call_mcp_tool`, pass both \
                         `server_name` (the section header below, e.g. GitHub) and `tool_name`. \
                         Use `load_mcp_schema` first to load a tool's definition and understand its parameters.\n\n",
                    );

                    let mut client_map: HashMap<String, (String, Peer<RoleClient>)> =
                        HashMap::new();
                    let mut schema_map: HashMap<String, String> = HashMap::new();

                    for (tools, client) in &loaded.server_tools {
                        if tools.is_empty() {
                            continue;
                        }
                        // Derive server name from the first tool's mapping
                        let server_name = tools
                            .first()
                            .and_then(|t| loaded.tool_name_to_server_name.get(&t.name.to_string()))
                            .cloned()
                            .unwrap_or_else(|| "unknown".to_string());

                        match sync_tool_definitions(&mcp_tools_dir, &server_name, tools) {
                            Ok(_server_dir) => {
                                mcp_catalog.push_str(&format!("### {}\n", server_name));
                                for tool in tools {
                                    let desc =
                                        tool.description.as_deref().unwrap_or("No description");
                                    mcp_catalog
                                        .push_str(&format!("- **{}** - {}\n", tool.name, desc));
                                    let key = format!("{}/{}", server_name, tool.name);
                                    client_map
                                        .insert(key.clone(), (server_name.clone(), client.clone()));
                                    let definition = serde_json::json!({
                                        "name": key,
                                        "description": tool.description,
                                        "inputSchema": tool.input_schema,
                                    });
                                    if let Ok(json_str) = serde_json::to_string_pretty(&definition)
                                    {
                                        schema_map.insert(key, json_str);
                                    }
                                }
                                mcp_catalog.push('\n');
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

                    effective_system_prompt.push_str(&mcp_catalog);
                    config = config
                        .with_mcp_call_tool(McpCallTool::new(Arc::new(RwLock::new(client_map))))
                        .with_load_mcp_schema_tool(LoadMcpSchemaTool::new(schema_map));
                } else {
                    // Below threshold: use the existing direct rmcp_tools approach
                    config = config.with_mcp_tools(loaded.server_tools);
                }
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

    // Set the effective system prompt (after MCP catalog may have been appended)
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

    // Strip images if model does not support vision
    let chat_messages = if capabilities.supports_vision == Some(false) {
        let image_count: usize = chat_messages.iter().map(|m| m.images.len()).sum();
        if image_count > 0 {
            tracing::warn!(
                "🚫 [agent_streaming] Model '{}' does not support vision; dropping {} image(s) from messages",
                model_id,
                image_count
            );
            let _ = app.emit(
                "chat-warning",
                serde_json::json!({
                    "conversation_id": conversation_id_clone,
                    "warning": "model_no_vision",
                }),
            );
        }
        chat_messages
            .into_iter()
            .map(|mut m| {
                m.images.clear();
                m
            })
            .collect::<Vec<_>>()
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
            "assistant" => build_assistant_message(&msg.content),
            "system" => {
                // System messages are handled via preamble in agent config
                // Skip them in history if we have a system_prompt in config
                if system_prompt.is_some() {
                    continue;
                }
                // Otherwise include as user message with system context
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

    // Track tool calls: HashMap<tool_call_id, (display_order, tool_name, tool_input, tool_output)>
    let tool_calls_map: Arc<
        RwLock<std::collections::HashMap<String, (i32, String, String, Option<String>)>>,
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

                    // For call_mcp_tool, extract server_name, real MCP tool name, and inner arguments
                    let (actual_tool_name, display_name, display_input) =
                        if tool_info.tool_name == "call_mcp_tool" {
                            if let Ok(parsed) =
                                serde_json::from_str::<serde_json::Value>(&tool_info.tool_input)
                            {
                                let server_name = parsed["server_name"]
                                    .as_str()
                                    .unwrap_or("unknown")
                                    .to_string();
                                let real_name = parsed["tool_name"]
                                    .as_str()
                                    .unwrap_or("call_mcp_tool")
                                    .to_string();
                                let inner_args = parsed
                                    .get("arguments")
                                    .map(|a| a.to_string())
                                    .unwrap_or_else(|| "{}".to_string());
                                // Store composite key for auth lookup; build display name directly
                                let composite_key = format!("{}/{}", server_name, real_name);
                                let display = format!(
                                    "mcp__{}__{}",
                                    sanitize_server_name(&server_name),
                                    real_name
                                );
                                (composite_key, display, inner_args)
                            } else {
                                let fallback_name = tool_info.tool_name.clone();
                                let display = mcp_display_name(
                                    &fallback_name,
                                    &mcp_server_name_map_for_callback,
                                );
                                (
                                    fallback_name,
                                    display,
                                    tool_info.tool_input.clone(),
                                )
                            }
                        } else {
                            let name = tool_info.tool_name.clone();
                            let display = mcp_display_name(
                                &name,
                                &mcp_server_name_map_for_callback,
                            );
                            (name, display, tool_info.tool_input.clone())
                        };

                    // Store tool call in tracking map (actual MCP tool name for auth lookup)
                    if let Ok(mut tool_calls) = tool_calls_for_callback.try_write() {
                        tool_calls.insert(
                            tool_info.id.clone(),
                            (
                                tool_order,
                                actual_tool_name,
                                display_input.clone(),
                                None,
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
                        && let Some((_, name, input, output)) = tool_calls.get_mut(&result_info.id)
                    {
                        *output = Some(result_info.tool_output.clone());

                        // Detect 401 auth errors from MCP tool calls (uses original name)
                        if is_auth_error(&result_info.tool_output) {
                            if let Some(server_id) = mcp_tool_map_for_callback.get(name.as_str()) {
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
                        let new_len = data_url.len();
                        // The API may re-send the same image with slightly
                        // different encoding (e.g. OpenRouter Gemini streams
                        // the image once, then echoes a re-encoded copy with
                        // the finish chunk).  Exact string match catches
                        // identical re-sends; size-based comparison catches
                        // re-encoded duplicates (typically <1% size diff).
                        if images.iter().any(|existing: &String| {
                            if *existing == data_url {
                                return true;
                            }
                            let existing_len = existing.len();
                            let diff = new_len.abs_diff(existing_len);
                            diff * 100 < existing_len.max(1) * 2
                        }) {
                            tracing::info!(
                                "🖼️ [streaming] Skipping duplicate image ({} bytes, similar to existing)",
                                new_len
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
        .map_or(false, |t| !t.is_empty());
    let has_images = !accumulated_images.read().await.is_empty();
    let has_any_data = !final_content.trim().is_empty()
        || has_tool_calls
        || has_reasoning_blocks
        || has_content_blocks
        || has_thinking
        || has_images;

    if !has_any_data {
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

    // Save generated images as file attachments linked to the assistant message
    if !images_snapshot.is_empty() {
        for (i, data_url) in images_snapshot.iter().enumerate() {
            // Parse data URL: "data:image/png;base64,<base64data>"
            let (mime_type, base64_data) = match data_url.strip_prefix("data:") {
                Some(rest) => match rest.split_once(",") {
                    Some((header, data)) => {
                        let mime = header
                            .split(';')
                            .next()
                            .unwrap_or("image/png")
                            .to_string();
                        (mime, data)
                    }
                    None => {
                        tracing::error!("Invalid data URL format for generated image {}", i + 1);
                        continue;
                    }
                },
                None => {
                    tracing::error!(
                        "Generated image {} is not a data URL, skipping",
                        i + 1
                    );
                    continue;
                }
            };

            let bytes = match base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                base64_data,
            ) {
                Ok(b) => b,
                Err(e) => {
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
                    if let Err(e) = crate::storage::write_binary(&app, &path, &bytes) {
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

        for (tool_call_id, (display_order, tool_name, tool_input, tool_output)) in
            tool_calls_data.iter()
        {
            let status = if tool_output.is_some() {
                "success"
            } else if was_cancelled {
                "cancelled"
            } else {
                "pending"
            };

            let display_name =
                mcp_display_name_from_stored(tool_name, &mcp_tool_name_to_server_name);

            match state_clone
                .db
                .create_tool_call(CreateToolCallRequest {
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
            if let Some(ref thinking) = parsed.thinking_content {
                if !thinking.trim().is_empty() {
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

    // Auto-generate title for new conversations (async, doesn't block the response)
    let state_for_title = state_clone.clone();
    let app_for_title = app.clone();
    let conversation_id_for_title = conversation_id_clone.clone();
    let content_for_title = content.clone();
    let final_content_for_title = final_content.clone();
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
            &final_content_for_title,
            &provider_for_title,
            &model_for_title,
            api_key_for_title,
            base_url_for_title,
            api_style_for_title,
        )
        .await;
    });
}

/// Result of loading MCP tools: server tools for the agent + mappings for tool name resolution.
struct LoadedMcpTools {
    server_tools: Vec<(Vec<McpTool>, Peer<RoleClient>)>,
    /// Maps MCP tool name (e.g. "search") to the DB tool ID of the MCP server that provides it.
    tool_name_to_server_id: HashMap<String, String>,
    /// Maps MCP tool name (e.g. "search") to the user-visible server name (e.g. "github").
    tool_name_to_server_name: HashMap<String, String>,
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
    let mut server_tools = Vec::new();

    for (conn, tools) in result.connections {
        for t in &tools {
            let key = format!("{}/{}", conn.tool.name, t.name);
            tool_name_to_server_id.insert(key.clone(), conn.tool.id.clone());
            tool_name_to_server_name.insert(key.clone(), conn.tool.name.clone());
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
