//! Chat commands module
//!
//! This module handles sending messages, streaming LLM responses, and related functionality.

mod attachment_processing;
pub(crate) mod aux_models;
mod compaction;
mod message_builder;
mod participants;
mod search_processing;
#[cfg(test)]
mod snapcompact_eval;
mod streaming;
pub mod title;
mod types;
mod url_processing;
pub mod web_search;

use super::AppState;
use crate::db::tools::{BUILTIN_READ_ID, BUILTIN_WEB_FETCH_ID, BUILTIN_WEB_SEARCH_ID};
use crate::models::{CreateMessageRequest, Message};
use crate::web_fetch;
use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

// Re-export types
pub use types::{FileAttachmentInput, ImageAttachmentInput, ParameterOverrides};

/// Send a message and start LLM generation
///
/// This command returns immediately after saving the user message.
/// LLM processing happens in a background task.
#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    conversation_id: String,
    content: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
    include_history: Option<bool>,
    system_prompt: Option<String>,
    user_prompt: Option<String>,
    model_db_id: Option<String>,
    assistant_db_id: Option<String>,
    urls_to_fetch: Option<Vec<String>>,
    images: Option<Vec<ImageAttachmentInput>>,
    files: Option<Vec<FileAttachmentInput>>,
    search_enabled: Option<bool>,
    parameter_overrides: Option<types::ParameterOverrides>,
    context_message_count: Option<i64>,
    use_provider_defaults: Option<bool>,
    disable_tools: Option<bool>,
    reuse_fetch_result_ids: Option<Vec<String>>,
) -> Result<Message, String> {
    log_send_message_params(
        &conversation_id,
        &content,
        &provider,
        &model,
        &base_url,
        &system_prompt,
        &user_prompt,
        &model_db_id,
        &assistant_db_id,
        &urls_to_fetch,
        &images,
        &files,
        &search_enabled,
        &parameter_overrides,
        &context_message_count,
        &use_provider_defaults,
        &reuse_fetch_result_ids,
    );

    // Save user message to database
    let user_message = save_user_message(&state, &conversation_id, &content).await?;

    // Auto-add participants
    participants::ensure_participants(&state, &conversation_id, &model_db_id, &assistant_db_id)
        .await;

    // Create and register cancellation token
    let cancel_token = CancellationToken::new();
    {
        let mut tasks = state.generation_tasks.write().await;
        tasks.insert(conversation_id.clone(), cancel_token.clone());
    }

    // Spawn background task
    spawn_background_task(
        state.inner().clone(),
        app,
        conversation_id,
        content,
        provider,
        model,
        api_key,
        base_url,
        api_style,
        include_history,
        system_prompt,
        user_prompt,
        model_db_id,
        assistant_db_id,
        urls_to_fetch,
        images,
        files,
        search_enabled.unwrap_or(false),
        user_message.id.clone(),
        cancel_token,
        parameter_overrides,
        context_message_count,
        use_provider_defaults.unwrap_or(false),
        disable_tools.unwrap_or(false),
        reuse_fetch_result_ids,
    );

    Ok(user_message)
}

/// Stop an active generation
#[tauri::command]
pub async fn stop_generation(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<bool, String> {
    tracing::info!(
        "🛑 [stop_generation] Stopping generation for conversation: {}",
        conversation_id
    );

    let tasks = state.generation_tasks.read().await;

    if let Some(cancel_token) = tasks.get(&conversation_id) {
        cancel_token.cancel();
        tracing::info!("✅ [stop_generation] Cancellation token triggered");

        state.bash_session_manager.abort_running(&conversation_id);

        let _ = app.emit(
            "generation-stopped",
            serde_json::json!({
                "conversation_id": conversation_id,
            }),
        );

        Ok(true)
    } else {
        tracing::warn!("⚠️ [stop_generation] No active task found for conversation");
        Ok(false)
    }
}

// ============================================================================
// Private helper functions
// ============================================================================

fn log_send_message_params(
    conversation_id: &str,
    content: &str,
    provider: &str,
    model: &str,
    base_url: &Option<String>,
    system_prompt: &Option<String>,
    user_prompt: &Option<String>,
    model_db_id: &Option<String>,
    assistant_db_id: &Option<String>,
    urls_to_fetch: &Option<Vec<String>>,
    images: &Option<Vec<ImageAttachmentInput>>,
    files: &Option<Vec<FileAttachmentInput>>,
    search_enabled: &Option<bool>,
    parameter_overrides: &Option<types::ParameterOverrides>,
    context_message_count: &Option<i64>,
    use_provider_defaults: &Option<bool>,
    reuse_fetch_result_ids: &Option<Vec<String>>,
) {
    tracing::info!("🚀 [send_message] Command received!");
    tracing::info!("   conversation_id: {}", conversation_id);
    tracing::info!("   content: {}", content);
    tracing::info!("   provider: {}", provider);
    tracing::info!("   model: {}", model);
    tracing::info!("   base_url: {:?}", base_url);
    tracing::info!("   has_system_prompt: {}", system_prompt.is_some());
    tracing::info!("   has_user_prompt: {}", user_prompt.is_some());
    tracing::info!("   model_db_id: {:?}", model_db_id);
    tracing::info!("   assistant_db_id: {:?}", assistant_db_id);
    tracing::info!("   urls_to_fetch: {:?}", urls_to_fetch);
    tracing::info!("   images count: {:?}", images.as_ref().map(|v| v.len()));
    tracing::info!("   files count: {:?}", files.as_ref().map(|v| v.len()));
    tracing::info!("   search_enabled: {:?}", search_enabled);
    tracing::info!("   parameter_overrides: {:?}", parameter_overrides);
    tracing::info!("   context_message_count: {:?}", context_message_count);
    tracing::info!("   use_provider_defaults: {:?}", use_provider_defaults);
    tracing::info!(
        "   reuse_fetch_result_ids: {:?}",
        reuse_fetch_result_ids.as_ref().map(|v| v.len())
    );
}

async fn save_user_message(
    state: &AppState,
    conversation_id: &str,
    content: &str,
) -> Result<Message, String> {
    tracing::info!("📝 [send_message] Creating user message in database...");
    let user_message = state
        .db
        .create_message(CreateMessageRequest {
            conversation_id: Some(conversation_id.to_string()),
            sender_type: "user".to_string(),
            sender_id: None,
            content: content.to_string(),
            tokens: None,
        })
        .await
        .map_err(|e| {
            tracing::info!("❌ [send_message] Failed to create message: {}", e);
            e.to_string()
        })?;

    tracing::info!(
        "✅ [send_message] User message created with id: {}",
        user_message.id
    );
    Ok(user_message)
}

#[allow(clippy::too_many_arguments)]
fn spawn_background_task(
    state: AppState,
    app: tauri::AppHandle,
    conversation_id: String,
    content: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
    include_history: Option<bool>,
    system_prompt: Option<String>,
    user_prompt: Option<String>,
    model_db_id: Option<String>,
    assistant_db_id: Option<String>,
    urls_to_fetch: Option<Vec<String>>,
    images: Option<Vec<ImageAttachmentInput>>,
    files: Option<Vec<FileAttachmentInput>>,
    search_enabled: bool,
    user_message_id: String,
    cancel_token: CancellationToken,
    parameter_overrides: Option<types::ParameterOverrides>,
    context_message_count: Option<i64>,
    use_provider_defaults: bool,
    disable_tools: bool,
    reuse_fetch_result_ids: Option<Vec<String>>,
) {
    tracing::info!("🔄 [send_message] Spawning background task...");

    tokio::spawn(async move {
        process_llm_request(
            state,
            app,
            conversation_id,
            content,
            provider,
            model,
            api_key,
            base_url,
            api_style,
            include_history,
            system_prompt,
            user_prompt,
            model_db_id,
            assistant_db_id,
            urls_to_fetch,
            images,
            files,
            search_enabled,
            user_message_id,
            cancel_token,
            parameter_overrides,
            context_message_count,
            use_provider_defaults,
            disable_tools,
            reuse_fetch_result_ids,
        )
        .await;
    });
}

/// Enabled builtin/MCP tool ids for this turn. Mirrors the resolution in
/// `handle_agent_streaming` closely enough for prompt-projection decisions:
/// assistant tools + conversation-level enabled tools, gated by tool-use
/// support. Skill-required tools are omitted deliberately — if a skill would
/// enable a tool later, the conservative projection (inline/lazy fallback)
/// stays correct.
async fn enabled_tool_ids(
    state: &AppState,
    provider: &str,
    model: &str,
    assistant_db_id: Option<&str>,
    conversation_id: &str,
    disable_tools: bool,
) -> Vec<String> {
    if disable_tools {
        return Vec::new();
    }
    if state
        .capabilities_cache
        .resolve(provider, model)
        .await
        .supports_tool_use
        == Some(false)
    {
        return Vec::new();
    }

    let mut tool_ids = Vec::new();
    if let Some(assistant_id) = assistant_db_id
        && let Ok(ids) = state.db.get_assistant_tool_ids(assistant_id).await
    {
        tool_ids.extend(ids);
    }
    if let Ok(settings) = state.db.get_conversation_settings(conversation_id).await {
        tool_ids.extend(settings.enabled_mcp_server_ids);
    }
    tool_ids
}

#[allow(clippy::too_many_arguments)]
async fn process_llm_request(
    state: AppState,
    app: tauri::AppHandle,
    conversation_id: String,
    content: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
    include_history: Option<bool>,
    system_prompt: Option<String>,
    user_prompt: Option<String>,
    model_db_id: Option<String>,
    assistant_db_id: Option<String>,
    urls_to_fetch: Option<Vec<String>>,
    images: Option<Vec<ImageAttachmentInput>>,
    files: Option<Vec<FileAttachmentInput>>,
    search_enabled: bool,
    user_message_id: String,
    cancel_token: CancellationToken,
    parameter_overrides: Option<types::ParameterOverrides>,
    context_message_count: Option<i64>,
    use_provider_defaults: bool,
    disable_tools: bool,
    reuse_fetch_result_ids: Option<Vec<String>>,
) {
    tracing::info!("🎯 [background_task] Started processing LLM request");

    let tool_ids = enabled_tool_ids(
        &state,
        &provider,
        &model,
        assistant_db_id.as_deref(),
        &conversation_id,
        disable_tools,
    )
    .await;
    let read_available = tool_ids.iter().any(|id| id == BUILTIN_READ_ID);
    // The model owns page retrieval when it can search or fetch; then the
    // search path stops at the result page.
    let model_can_fetch = tool_ids
        .iter()
        .any(|id| id == BUILTIN_WEB_SEARCH_ID || id == BUILTIN_WEB_FETCH_ID);

    // Step 1: Process search if enabled
    let search_result = if search_enabled {
        search_processing::process_search_decision(
            &state,
            &app,
            &content,
            &provider,
            &model,
            api_key.as_deref(),
            base_url.as_deref(),
            api_style.as_deref(),
            &user_message_id,
            &conversation_id,
            model_can_fetch,
        )
        .await
    } else {
        search_processing::SearchProcessingResult {
            urls: Vec::new(),
            search_result_id: None,
            serp_context: None,
        }
    };

    // User-provided URLs are always fetched: the user explicitly attached
    // them. Result-page URLs are only fetched when the model cannot read
    // them itself.
    let mut urls_to_fetch = urls_to_fetch.unwrap_or_default();
    let fetch_source_id = if search_result.urls.is_empty() {
        None
    } else {
        search_result.search_result_id.clone()
    };
    urls_to_fetch.extend(search_result.urls);

    // Step 2: Reuse existing fetch_results (resend path) and/or fetch new URLs.
    // Reuse is processed first so reused ids win over any duplicate URL the
    // frontend may have also included.
    let reuse_ids_owned = reuse_fetch_result_ids.unwrap_or_default();
    let url_result = url_processing::fetch_and_store_urls(
        &state,
        &app,
        &urls_to_fetch,
        &reuse_ids_owned,
        &user_message_id,
        &conversation_id,
        fetch_source_id.as_deref(),
    )
    .await;

    // Step 3: Build LLM content with fetched resources and the SERP block
    let mut processed_content =
        web_fetch::build_llm_content_with_attachments(&content, &url_result.fetched_resources);
    if let Some(serp_context) = &search_result.serp_context {
        processed_content.push_str("\n\n---\n");
        processed_content.push_str(serp_context);
    }

    // Step 4: Parse attachments
    let user_images = attachment_processing::parse_image_attachments(images);
    let user_files = attachment_processing::parse_file_attachments(files);

    // Step 5: Store attachments
    let stored_files = attachment_processing::store_file_attachments(
        &state,
        &app,
        &user_files,
        &user_message_id,
        &conversation_id,
    )
    .await;

    let stored_images = attachment_processing::store_image_attachments(
        &state,
        &app,
        &user_images,
        &user_message_id,
        &conversation_id,
    )
    .await;

    // Large attachments are projected as a path manifest only when the
    // conversation can actually fetch them back with the read tool.
    // (`read_available` is computed with the tool set above.)

    // Step 6: Build chat messages with context limit
    let chat_messages = message_builder::build_chat_messages(
        &state,
        &conversation_id,
        &user_message_id,
        &processed_content,
        &user_prompt,
        &system_prompt,
        include_history.unwrap_or(true),
        &user_images,
        &user_files,
        &stored_files,
        &app,
        read_available,
        context_message_count,
    )
    .await;

    // Step 7: Get assistant config and build model params
    let assistant_config = get_assistant_config(&state, &assistant_db_id).await;

    // Determine model params based on settings:
    // - use_provider_defaults: true -> use empty params (provider defaults)
    // - parameter_overrides: set -> use custom overrides
    // - otherwise -> use assistant preset (if available)
    let model_params = if use_provider_defaults {
        tracing::info!("📋 [background_task] Using provider defaults (no parameters sent)");
        crate::models::ModelParameters::default()
    } else if let Some(overrides) = parameter_overrides {
        // Custom parameter overrides
        let mut params = crate::models::ModelParameters::default();
        if overrides.temperature.is_some() {
            params.temperature = overrides.temperature;
        }
        if overrides.max_tokens.is_some() {
            params.max_tokens = overrides.max_tokens;
        }
        if overrides.top_p.is_some() {
            params.top_p = overrides.top_p;
        }
        if overrides.frequency_penalty.is_some() {
            params.frequency_penalty = overrides.frequency_penalty;
        }
        if overrides.presence_penalty.is_some() {
            params.presence_penalty = overrides.presence_penalty;
        }
        tracing::info!(
            "📋 [background_task] Applied custom parameter overrides: temp={:?}, max_tokens={:?}, top_p={:?}",
            params.temperature,
            params.max_tokens,
            params.top_p
        );
        params
    } else {
        // Use assistant preset params (if any)
        assistant_config
            .as_ref()
            .and_then(|a| a.preset.as_ref())
            .map(|preset| {
                tracing::info!(
                    "📋 [background_task] Using assistant preset: temp={:?}, max_tokens={:?}",
                    preset.temperature,
                    preset.max_tokens
                );
                crate::models::ModelParameters {
                    temperature: preset.temperature,
                    max_tokens: preset.max_tokens,
                    top_p: preset.top_p,
                    frequency_penalty: preset.frequency_penalty,
                    presence_penalty: preset.presence_penalty,
                    additional_params: preset.additional_params.clone(),
                }
            })
            .unwrap_or_default()
    };

    let system_prompt_for_agent = chat_messages
        .first()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone());

    // Step 8: Stream LLM response
    tracing::info!(
        "📤 [background_task] Sending chat request to LLM (model: {})",
        model
    );
    tracing::info!("🤖 [background_task] Using agent-based streaming");

    streaming::handle_agent_streaming(
        provider,
        model,
        chat_messages,
        api_key,
        base_url,
        api_style,
        system_prompt_for_agent,
        model_params,
        cancel_token,
        state,
        app,
        conversation_id,
        content,
        model_db_id,
        assistant_db_id,
        disable_tools,
        stored_images,
    )
    .await;
}

async fn get_assistant_config(
    state: &AppState,
    assistant_db_id: &Option<String>,
) -> Option<crate::models::Assistant> {
    if let Some(assistant_id) = assistant_db_id {
        match state.db.get_assistant(assistant_id).await {
            Ok(Some(assistant)) => {
                let temp = assistant.preset.as_ref().and_then(|p| p.temperature);
                let max_tokens = assistant.preset.as_ref().and_then(|p| p.max_tokens);
                tracing::info!(
                    "📋 [background_task] Using assistant config: temp={:?}, max_tokens={:?}",
                    temp,
                    max_tokens
                );
                Some(assistant)
            }
            Ok(None) => {
                tracing::warn!(
                    "⚠️  [background_task] Assistant not found: {}",
                    assistant_id
                );
                None
            }
            Err(e) => {
                tracing::warn!("⚠️  [background_task] Error fetching assistant: {}", e);
                None
            }
        }
    } else {
        None
    }
}
