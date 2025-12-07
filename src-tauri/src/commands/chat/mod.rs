//! Chat commands module
//!
//! This module handles sending messages, streaming LLM responses, and related functionality.

mod attachment_processing;
mod message_builder;
mod participants;
mod search_processing;
mod streaming;
pub mod title;
mod types;
mod url_processing;
pub mod web_search;

use super::AppState;
use crate::models::{CreateMessageRequest, Message};
use crate::web_fetch;
use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

// Re-export types
pub use types::{FileAttachmentInput, ImageAttachmentInput};

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
    include_history: Option<bool>,
    system_prompt: Option<String>,
    user_prompt: Option<String>,
    model_db_id: Option<String>,
    assistant_db_id: Option<String>,
    urls_to_fetch: Option<Vec<String>>,
    images: Option<Vec<ImageAttachmentInput>>,
    files: Option<Vec<FileAttachmentInput>>,
    search_enabled: Option<bool>,
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
    println!(
        "🛑 [stop_generation] Stopping generation for conversation: {}",
        conversation_id
    );

    let tasks = state.generation_tasks.read().await;

    if let Some(cancel_token) = tasks.get(&conversation_id) {
        cancel_token.cancel();
        println!("✅ [stop_generation] Cancellation token triggered");

        let _ = app.emit(
            "generation-stopped",
            serde_json::json!({
                "conversation_id": conversation_id,
            }),
        );

        Ok(true)
    } else {
        println!("⚠️ [stop_generation] No active task found for conversation");
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
) {
    println!("🚀 [send_message] Command received!");
    println!("   conversation_id: {}", conversation_id);
    println!("   content: {}", content);
    println!("   provider: {}", provider);
    println!("   model: {}", model);
    println!("   base_url: {:?}", base_url);
    println!("   has_system_prompt: {}", system_prompt.is_some());
    println!("   has_user_prompt: {}", user_prompt.is_some());
    println!("   model_db_id: {:?}", model_db_id);
    println!("   assistant_db_id: {:?}", assistant_db_id);
    println!("   urls_to_fetch: {:?}", urls_to_fetch);
    println!("   images count: {:?}", images.as_ref().map(|v| v.len()));
    println!("   files count: {:?}", files.as_ref().map(|v| v.len()));
    println!("   search_enabled: {:?}", search_enabled);
}

async fn save_user_message(
    state: &AppState,
    conversation_id: &str,
    content: &str,
) -> Result<Message, String> {
    println!("📝 [send_message] Creating user message in database...");
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
            println!("❌ [send_message] Failed to create message: {}", e);
            e.to_string()
        })?;

    println!(
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
) {
    println!("🔄 [send_message] Spawning background task...");

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
        )
        .await;
    });
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
) {
    println!("🎯 [background_task] Started processing LLM request");

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
            &user_message_id,
            &conversation_id,
            urls_to_fetch.unwrap_or_default(),
        )
        .await
    } else {
        search_processing::SearchProcessingResult {
            urls: urls_to_fetch.unwrap_or_default(),
            search_result_id: None,
        }
    };

    // Step 2: Fetch URLs
    let url_result = url_processing::fetch_and_store_urls(
        &state,
        &app,
        &search_result.urls,
        &user_message_id,
        &conversation_id,
        search_result.search_result_id.as_deref(),
    )
    .await;

    // Step 3: Build LLM content with fetched resources
    let processed_content =
        web_fetch::build_llm_content_with_attachments(&content, &url_result.fetched_resources);

    // Step 4: Parse attachments
    let user_images = attachment_processing::parse_image_attachments(images);
    let user_files = attachment_processing::parse_file_attachments(files);

    // Step 5: Store attachments
    attachment_processing::store_file_attachments(
        &state,
        &app,
        &user_files,
        &user_message_id,
        &conversation_id,
    )
    .await;

    attachment_processing::store_image_attachments(
        &state,
        &app,
        &user_images,
        &user_message_id,
        &conversation_id,
    )
    .await;

    // Step 6: Build chat messages
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
    )
    .await;

    // Step 7: Get assistant config and model params
    let assistant_config = get_assistant_config(&state, &assistant_db_id).await;

    let model_params = assistant_config
        .as_ref()
        .map(|a| a.model_params.clone())
        .unwrap_or_default();

    let system_prompt_for_agent = chat_messages
        .first()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone());

    // Step 8: Stream LLM response
    println!(
        "📤 [background_task] Sending chat request to LLM (model: {})",
        model
    );
    println!("🤖 [background_task] Using agent-based streaming");

    streaming::handle_agent_streaming(
        provider,
        model,
        chat_messages,
        api_key,
        base_url,
        system_prompt_for_agent,
        model_params,
        cancel_token,
        state,
        app,
        conversation_id,
        content,
        model_db_id,
        assistant_db_id,
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
                println!(
                    "📋 [background_task] Using assistant config: temp={:?}, max_tokens={:?}",
                    assistant.model_params.temperature, assistant.model_params.max_tokens
                );
                Some(assistant)
            }
            Ok(None) => {
                println!("⚠️  [background_task] Assistant not found: {}", assistant_id);
                None
            }
            Err(e) => {
                eprintln!("⚠️  [background_task] Error fetching assistant: {}", e);
                None
            }
        }
    } else {
        None
    }
}
