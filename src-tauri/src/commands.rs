use crate::crypto;
use crate::db::Database;
use crate::llm::{self, ChatMessage};
use crate::models::*;
use crate::prompts;
use crate::web_fetch;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

pub use crate::llm::models::ModelInfo;

// Global state to track active generation tasks with cancellation tokens
type GenerationTasks = Arc<RwLock<HashMap<String, CancellationToken>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub generation_tasks: GenerationTasks,
}

// Provider commands
#[tauri::command]
pub async fn create_provider(
    state: State<'_, AppState>,
    req: CreateProviderRequest,
) -> Result<Provider, String> {
    state.db.create_provider(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_provider(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Provider>, String> {
    state.db.get_provider(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> Result<Vec<Provider>, String> {
    state.db.list_providers().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    req: CreateProviderRequest,
) -> Result<Provider, String> {
    state
        .db
        .update_provider(&id, req)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_provider(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_provider(&id).map_err(|e| e.to_string())
}

// Model commands
#[tauri::command]
pub async fn create_model(
    state: State<'_, AppState>,
    req: CreateModelRequest,
) -> Result<Model, String> {
    state.db.create_model(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_model(state: State<'_, AppState>, id: String) -> Result<Option<Model>, String> {
    state.db.get_model(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Vec<Model>, String> {
    state.db.list_models().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_all_models(state: State<'_, AppState>) -> Result<Vec<Model>, String> {
    state.db.list_all_models().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_model(
    state: State<'_, AppState>,
    id: String,
    req: CreateModelRequest,
) -> Result<Model, String> {
    state.db.update_model(&id, req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_model(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_model(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn soft_delete_model(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.soft_delete_model(&id).map_err(|e| e.to_string())
}

// Assistant commands
#[tauri::command]
pub async fn create_assistant(
    state: State<'_, AppState>,
    req: CreateAssistantRequest,
) -> Result<Assistant, String> {
    state.db.create_assistant(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_assistant(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Assistant>, String> {
    state.db.get_assistant(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_assistants(state: State<'_, AppState>) -> Result<Vec<Assistant>, String> {
    state.db.list_assistants().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_assistant(
    state: State<'_, AppState>,
    id: String,
    req: CreateAssistantRequest,
) -> Result<Assistant, String> {
    state
        .db
        .update_assistant(&id, req)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_assistant(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_assistant(&id).map_err(|e| e.to_string())
}

// User commands
#[tauri::command]
pub async fn create_user(
    state: State<'_, AppState>,
    req: CreateUserRequest,
) -> Result<User, String> {
    state.db.create_user(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user(state: State<'_, AppState>, id: String) -> Result<Option<User>, String> {
    state.db.get_user(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_self_user(state: State<'_, AppState>) -> Result<Option<User>, String> {
    state.db.get_self_user().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_users(state: State<'_, AppState>) -> Result<Vec<User>, String> {
    state.db.list_users().map_err(|e| e.to_string())
}

// Conversation commands
#[tauri::command]
pub async fn create_conversation(
    state: State<'_, AppState>,
    req: CreateConversationRequest,
) -> Result<Conversation, String> {
    state.db.create_conversation(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_conversation(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Conversation>, String> {
    state.db.get_conversation(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    state.db.list_conversations().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_conversation(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<Conversation, String> {
    state
        .db
        .update_conversation(&id, &title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_conversation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_conversation(&id).map_err(|e| e.to_string())
}

// Conversation Participant commands
#[tauri::command]
pub async fn add_conversation_participant(
    state: State<'_, AppState>,
    req: CreateConversationParticipantRequest,
) -> Result<ConversationParticipant, String> {
    state
        .db
        .add_conversation_participant(req)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_conversation_participants(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<ConversationParticipant>, String> {
    state
        .db
        .list_conversation_participants(&conversation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_conversation_participant_summary(
    state: State<'_, AppState>,
    conversation_id: String,
    current_user_id: String,
) -> Result<Vec<ParticipantSummary>, String> {
    state
        .db
        .get_conversation_participant_summary(&conversation_id, &current_user_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_conversation_participant(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state
        .db
        .remove_conversation_participant(&id)
        .map_err(|e| e.to_string())
}

// Message commands
#[tauri::command]
pub async fn create_message(
    state: State<'_, AppState>,
    req: CreateMessageRequest,
) -> Result<Message, String> {
    state.db.create_message(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_messages_by_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    state
        .db
        .list_messages_by_conversation(&conversation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_messages_by_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    state
        .db
        .delete_messages_in_conversation(&conversation_id)
        .map_err(|e| e.to_string())
}

// ==========================================================================
// CATEGORY 1: USER ATTACHMENTS (user-provided files and links)
// ==========================================================================

#[tauri::command]
pub async fn get_message_attachments(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Vec<UserAttachment>, String> {
    state
        .db
        .get_message_attachments(&message_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_attachment(
    state: State<'_, AppState>,
    id: String,
) -> Result<FileAttachment, String> {
    state.db.get_file_attachment(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user_link(
    state: State<'_, AppState>,
    id: String,
) -> Result<UserLink, String> {
    state.db.get_user_link(&id).map_err(|e| e.to_string())
}

// ==========================================================================
// CATEGORY 2: CONTEXT ENRICHMENTS (system-fetched content)
// ==========================================================================

#[tauri::command]
pub async fn get_message_contexts(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Vec<ContextEnrichment>, String> {
    state
        .db
        .get_message_contexts(&message_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_search_result(
    state: State<'_, AppState>,
    id: String,
) -> Result<SearchResult, String> {
    state.db.get_search_result(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_fetch_result(
    state: State<'_, AppState>,
    id: String,
) -> Result<FetchResult, String> {
    state.db.get_fetch_result(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_fetch_results_by_source(
    state: State<'_, AppState>,
    source_type: String,
    source_id: String,
) -> Result<Vec<FetchResult>, String> {
    state
        .db
        .get_fetch_results_by_source(&source_type, &source_id)
        .map_err(|e| e.to_string())
}

// ==========================================================================
// CATEGORY 3: PROCESS STEPS (AI workflow artifacts)
// ==========================================================================

#[tauri::command]
pub async fn get_message_steps(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Vec<ProcessStep>, String> {
    state
        .db
        .get_message_steps(&message_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_thinking_step(
    state: State<'_, AppState>,
    id: String,
) -> Result<ThinkingStep, String> {
    state.db.get_thinking_step(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_search_decision(
    state: State<'_, AppState>,
    id: String,
) -> Result<SearchDecision, String> {
    state.db.get_search_decision(&id).map_err(|e| e.to_string())
}

// ==========================================================================
// COMBINED: Get All Message Resources
// ==========================================================================

#[tauri::command]
pub async fn get_message_resources(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<MessageResources, String> {
    state
        .db
        .get_message_resources(&message_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_fetch_content(
    app: tauri::AppHandle,
    storage_path: String,
) -> Result<String, String> {
    crate::storage::read_content(&app, &storage_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_file_content(
    app: tauri::AppHandle,
    storage_path: String,
) -> Result<String, String> {
    crate::storage::read_content(&app, &storage_path).map_err(|e| e.to_string())
}

// Read arbitrary text file from filesystem (for files selected via dialog)
#[tauri::command]
pub async fn read_text_file_from_path(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

// Read arbitrary binary file as base64 (for files selected via dialog)
#[tauri::command]
pub async fn read_file_as_base64(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
pub async fn read_image_base64(
    app: tauri::AppHandle,
    storage_path: String,
) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let bytes = crate::storage::read_binary(&app, &storage_path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn get_attachment_url(app: tauri::AppHandle, storage_path: String) -> Result<String, String> {
    let full_path =
        crate::storage::get_full_path(&app, &storage_path).map_err(|e| e.to_string())?;
    Ok(full_path.to_string_lossy().to_string())
}

// Settings commands
#[tauri::command]
pub async fn get_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    state.db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state
        .db
        .set_setting(&key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_settings(state: State<'_, AppState>) -> Result<Vec<Setting>, String> {
    state.db.get_all_settings().map_err(|e| e.to_string())
}

// Crypto commands
#[tauri::command]
pub async fn generate_keypair() -> Result<crypto::GeneratedKeyPair, String> {
    crypto::generate_keypair().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_keypair(public_key: String, private_key: String) -> Result<String, String> {
    crypto::export_keypair(&public_key, &private_key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_keypair(json: String) -> Result<crypto::GeneratedKeyPair, String> {
    crypto::import_keypair(&json).map_err(|e| e.to_string())
}

// Models commands
#[tauri::command]
pub async fn fetch_openai_models(api_key: String) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_openai_models(api_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_openrouter_models(api_key: String) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_openrouter_models(api_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_ollama_models(base_url: String) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_ollama_models(base_url)
        .await
        .map_err(|e| e.to_string())
}

// Helper function to generate conversation title
async fn generate_conversation_title(
    state: &AppState,
    _conversation_id: &str,
    user_message: &str,
    assistant_message: &str,
    provider: &str,
    model: &str,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<String> {
    println!("🏷️ [generate_title] Starting title generation...");

    // Check if there's a custom summary model setting
    let summary_model_id = state
        .db
        .get_setting("conversation_summary_model_id")
        .ok()
        .flatten();

    let (summary_provider, summary_model, summary_api_key, summary_base_url) = if let Some(
        model_id,
    ) =
        summary_model_id
    {
        // Get the custom model settings
        match state.db.get_model(&model_id) {
            Ok(Some(m)) => {
                // Get provider info
                match state.db.get_provider(&m.provider_id) {
                    Ok(Some(p)) => {
                        println!(
                            "🏷️ [generate_title] Using custom summary model: {} from provider: {}",
                            m.model_id, p.provider_type
                        );
                        (
                            p.provider_type.clone(),
                            m.model_id.clone(),
                            p.api_key.clone(),
                            p.base_url.clone(),
                        )
                    }
                    _ => {
                        println!(
                            "🏷️ [generate_title] Custom model provider not found, using current model"
                        );
                        (
                            provider.to_string(),
                            model.to_string(),
                            api_key.clone(),
                            base_url.clone(),
                        )
                    }
                }
            }
            _ => {
                println!("🏷️ [generate_title] Custom model not found, using current model");
                (
                    provider.to_string(),
                    model.to_string(),
                    api_key.clone(),
                    base_url.clone(),
                )
            }
        }
    } else {
        // Use the current conversation model by default
        println!("🏷️ [generate_title] No custom summary model set, using current model");
        (
            provider.to_string(),
            model.to_string(),
            api_key.clone(),
            base_url.clone(),
        )
    };

    // Generate title using unified provider handler
    let response = llm::call_provider(
        &summary_provider,
        summary_model,
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: prompts::TITLE_GENERATION_SYSTEM_PROMPT.to_string(),
                images: vec![],
                files: vec![],
            },
            ChatMessage {
                role: "user".to_string(),
                content: prompts::build_title_generation_user_prompt(
                    user_message,
                    assistant_message,
                ),
                images: vec![],
                files: vec![],
            },
        ],
        summary_api_key,
        summary_base_url,
    )
    .await?;

    // Clean up the title (remove quotes, extra whitespace, etc.)
    let title = response
        .content
        .trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '.' || c == ',' || c == '!' || c == '?')
        .trim()
        .to_string();

    println!("🏷️ [generate_title] Generated title: {}", title);
    Ok(title)
}

// Helper function to auto-generate title for new conversations
async fn auto_generate_title_if_needed(
    state: &AppState,
    app: &tauri::AppHandle,
    conversation_id: &str,
    user_content: &str,
    assistant_content: &str,
    provider: &str,
    model: &str,
    api_key: Option<String>,
    base_url: Option<String>,
) {
    if let Ok(Some(conversation)) = state.db.get_conversation(conversation_id) {
        if conversation.title == "New Conversation" {
            println!("🏷️ [auto_title] Generating title for new conversation...");
            match generate_conversation_title(
                state,
                conversation_id,
                user_content,
                assistant_content,
                provider,
                model,
                api_key,
                base_url,
            )
            .await
            {
                Ok(title) => {
                    match state.db.update_conversation(conversation_id, &title) {
                        Ok(_) => {
                            println!("✅ [auto_title] Conversation title updated to: {}", title);
                            // Notify frontend of title update
                            let _ = app.emit(
                                "conversation-updated",
                                serde_json::json!({
                                    "conversation_id": conversation_id,
                                    "title": title,
                                }),
                            );
                        }
                        Err(e) => eprintln!(
                            "⚠️  [auto_title] Failed to update conversation title: {}",
                            e
                        ),
                    }
                }
                Err(e) => eprintln!("⚠️  [auto_title] Failed to generate title: {}", e),
            }
        }
    }
}

// Helper function to handle streaming for any provider (eliminates duplication)
async fn handle_provider_streaming(
    provider: String,
    model: String,
    chat_messages: Vec<ChatMessage>,
    api_key: Option<String>,
    base_url: Option<String>,
    cancel_token: CancellationToken,
    state_clone: AppState,
    app: tauri::AppHandle,
    conversation_id_clone: String,
    content: String,
    model_db_id: Option<String>,
    assistant_db_id: Option<String>,
) {
    println!("✅ [background_task] Using {} provider", provider);

    // Create the appropriate provider
    let request = llm::ChatRequest {
        model: model.clone(),
        messages: chat_messages.clone(),
        stream: true,
    };

    // Track accumulated content for cancellation handling
    let accumulated_content = Arc::new(RwLock::new(String::new()));
    let accumulated_content_clone = accumulated_content.clone();
    let conversation_id_for_stream = conversation_id_clone.clone();
    let app_for_stream = app.clone();
    let cancel_token_for_callback = cancel_token.clone();

    // Call the appropriate provider and handle streaming
    let response = match provider.as_str() {
        "openai" => {
            let api_key_val = match api_key.clone() {
                Some(k) => k,
                None => {
                    eprintln!("❌ [background_task] OpenAI API key required");
                    let mut tasks = state_clone.generation_tasks.write().await;
                    tasks.remove(&conversation_id_clone);
                    return;
                }
            };
            let provider = llm::openai::OpenAIRigProvider::new(api_key_val, base_url.clone());
            provider
                .chat_stream(
                    request,
                    cancel_token.clone(),
                    move |chunk: String| -> bool {
                        // Check if cancelled
                        if cancel_token_for_callback.is_cancelled() {
                            println!("🛑 [streaming] Generation cancelled, stopping stream");
                            return false;
                        }

                        // Accumulate content
                        if let Ok(mut content) = accumulated_content_clone.try_write() {
                            content.push_str(&chunk);
                        }

                        let payload = serde_json::json!({
                            "conversation_id": conversation_id_for_stream,
                            "content": chunk,
                        });
                        let _ = app_for_stream.emit("chat-stream", payload);

                        true // Continue streaming
                    },
                )
                .await
        }
        "openrouter" => {
            let api_key_val = match api_key.clone() {
                Some(k) => k,
                None => {
                    eprintln!("❌ [background_task] OpenRouter API key required");
                    let mut tasks = state_clone.generation_tasks.write().await;
                    tasks.remove(&conversation_id_clone);
                    return;
                }
            };
            let provider =
                llm::openrouter::OpenRouterRigProvider::new(api_key_val, base_url.clone());
            provider
                .chat_stream(
                    request,
                    cancel_token.clone(),
                    move |chunk: String| -> bool {
                        // Check if cancelled
                        if cancel_token_for_callback.is_cancelled() {
                            println!("🛑 [streaming] Generation cancelled, stopping stream");
                            return false;
                        }

                        // Accumulate content
                        if let Ok(mut content) = accumulated_content_clone.try_write() {
                            content.push_str(&chunk);
                        }

                        let payload = serde_json::json!({
                            "conversation_id": conversation_id_for_stream,
                            "content": chunk,
                        });
                        let _ = app_for_stream.emit("chat-stream", payload);

                        true // Continue streaming
                    },
                )
                .await
        }
        "ollama" => {
            let provider = llm::ollama::OllamaRigProvider::new(base_url.clone());
            provider
                .chat_stream(
                    request,
                    cancel_token.clone(),
                    move |chunk: String| -> bool {
                        // Check if cancelled
                        if cancel_token_for_callback.is_cancelled() {
                            println!("🛑 [streaming] Generation cancelled, stopping stream");
                            return false;
                        }

                        // Accumulate content
                        if let Ok(mut content) = accumulated_content_clone.try_write() {
                            content.push_str(&chunk);
                        }

                        let payload = serde_json::json!({
                            "conversation_id": conversation_id_for_stream,
                            "content": chunk,
                        });
                        let _ = app_for_stream.emit("chat-stream", payload);

                        true // Continue streaming
                    },
                )
                .await
        }
        _ => {
            eprintln!("❌ [background_task] Unknown provider: {}", provider);
            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            return;
        }
    };

    let response = match response {
        Ok(r) => r,
        Err(e) => {
            eprintln!("LLM request failed: {}", e);

            // Emit error event to frontend
            let error_payload = serde_json::json!({
                "conversation_id": conversation_id_clone,
                "error": e.to_string(),
            });
            let _ = app.emit("chat-error", error_payload);

            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            return;
        }
    };

    // Use response content directly
    let final_content = response.content.clone();

    if final_content.is_empty() {
        println!("⚠️ [background_task] No content to save, skipping");
        let mut tasks = state_clone.generation_tasks.write().await;
        tasks.remove(&conversation_id_clone);
        return;
    }

    // Determine sender_type and sender_id
    let (sender_type, sender_id) = if let Some(model_id) = model_db_id.clone() {
        ("model".to_string(), Some(model_id))
    } else if let Some(assistant_id) = assistant_db_id.clone() {
        ("assistant".to_string(), Some(assistant_id))
    } else {
        ("assistant".to_string(), None)
    };

    // Save assistant message
    let assistant_message = match state_clone.db.create_message(CreateMessageRequest {
        conversation_id: Some(conversation_id_clone.clone()),
        sender_type,
        sender_id,
        content: final_content.clone(),
        tokens: response.tokens,
    }) {
        Ok(msg) => msg,
        Err(e) => {
            eprintln!("Failed to save assistant message: {}", e);
            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            return;
        }
    };

    // Save thinking content as a ThinkingStep if present
    if let Some(thinking_content) = response.thinking_content {
        if !thinking_content.is_empty() {
            match state_clone.db.create_thinking_step(CreateThinkingStepRequest {
                content: thinking_content,
                source: Some("llm".to_string()),
            }) {
                Ok(thinking_step) => {
                    if let Err(e) = state_clone.db.link_message_step(
                        &assistant_message.id,
                        StepType::Thinking,
                        &thinking_step.id,
                        Some(0),
                    ) {
                        eprintln!("Failed to link thinking step: {}", e);
                    }
                }
                Err(e) => {
                    eprintln!("Failed to save thinking step: {}", e);
                }
            }
        }
    }

    println!(
        "✅ [background_task] Assistant message saved with id: {}",
        assistant_message.id
    );

    // Notify frontend that streaming is complete (do this first, before title generation)
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
    let provider_for_title = provider.clone();
    let model_for_title = model.clone();
    tokio::spawn(async move {
        auto_generate_title_if_needed(
            &state_for_title,
            &app_for_title,
            &conversation_id_for_title,
            &content_for_title,
            &final_content_for_title,
            &provider_for_title,
            &model_for_title,
            api_key,
            base_url,
        )
        .await;
    });
}

/// File attachment data from frontend
#[derive(Debug, Clone, serde::Deserialize)]
pub struct FileAttachmentInput {
    pub name: String,
    pub content: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

/// Image attachment data from frontend
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ImageAttachmentInput {
    pub name: String,
    pub base64: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

// Chat command - now returns immediately and processes in background
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
    println!(
        "   images count: {:?}",
        images.as_ref().map(|v| v.len())
    );
    println!("   files count: {:?}", files.as_ref().map(|v| v.len()));
    println!("   search_enabled: {:?}", search_enabled);

    // Save user message to database with original content first
    // URL processing will happen in background
    println!("📝 [send_message] Creating user message in database...");
    let user_message = state
        .db
        .create_message(CreateMessageRequest {
            conversation_id: Some(conversation_id.clone()),
            sender_type: "user".to_string(),
            sender_id: None,
            content: content.clone(),
            tokens: None,
        })
        .map_err(|e| {
            println!("❌ [send_message] Failed to create message: {}", e);
            e.to_string()
        })?;

    println!(
        "✅ [send_message] User message created with id: {}",
        user_message.id
    );

    // Auto-add participants - supports multiple models/assistants in same conversation
    // This ensures conversation_participants table is populated for UI display
    let existing_participants = state
        .db
        .list_conversation_participants(&conversation_id)
        .map_err(|e| e.to_string())?;

    // Check if we need to add participants
    let has_user = existing_participants
        .iter()
        .any(|p| p.participant_type == "user");

    // Check if the SPECIFIC model or assistant is already a participant
    let current_model_exists = if let Some(ref model_id) = model_db_id {
        existing_participants
            .iter()
            .any(|p| p.participant_type == "model" && p.participant_id.as_ref() == Some(model_id))
    } else {
        false
    };

    let current_assistant_exists = if let Some(ref assistant_id) = assistant_db_id {
        existing_participants.iter().any(|p| {
            p.participant_type == "assistant" && p.participant_id.as_ref() == Some(assistant_id)
        })
    } else {
        false
    };

    println!(
        "📋 [send_message] Current participants: {} total",
        existing_participants.len()
    );
    println!("   has_user: {}", has_user);
    println!(
        "   current_model_exists: {} (model_db_id: {:?})",
        current_model_exists, model_db_id
    );
    println!(
        "   current_assistant_exists: {} (assistant_db_id: {:?})",
        current_assistant_exists, assistant_db_id
    );

    // Add self user if not present
    if !has_user {
        println!("👤 [send_message] Adding self user as participant...");
        match state.db.get_self_user() {
            Ok(Some(self_user)) => {
                match state
                    .db
                    .add_conversation_participant(CreateConversationParticipantRequest {
                        conversation_id: conversation_id.clone(),
                        participant_type: "user".to_string(),
                        participant_id: Some(self_user.id.clone()),
                        display_name: Some(self_user.display_name.clone()),
                    }) {
                    Ok(_) => println!("✅ [send_message] Added self user as participant"),
                    Err(e) => println!("⚠️  [send_message] Failed to add self user: {}", e),
                }
            }
            Ok(None) => println!("⚠️  [send_message] No self user found"),
            Err(e) => println!("⚠️  [send_message] Error getting self user: {}", e),
        }
    }

    // Add assistant if the SPECIFIC one is not present
    if let Some(assistant_id) = &assistant_db_id {
        if !current_assistant_exists {
            println!(
                "🤖 [send_message] Adding NEW assistant as participant (assistant_id: {})...",
                assistant_id
            );
            match state.db.get_assistant(assistant_id) {
                Ok(Some(assistant)) => {
                    match state.db.add_conversation_participant(
                        CreateConversationParticipantRequest {
                            conversation_id: conversation_id.clone(),
                            participant_type: "assistant".to_string(),
                            participant_id: Some(assistant.id.clone()),
                            display_name: Some(assistant.name.clone()),
                        },
                    ) {
                        Ok(_) => println!(
                            "✅ [send_message] Added assistant '{}' as participant",
                            assistant.name
                        ),
                        Err(e) => println!("⚠️  [send_message] Failed to add assistant: {}", e),
                    }
                }
                Ok(None) => println!("⚠️  [send_message] Assistant not found: {}", assistant_id),
                Err(e) => println!("⚠️  [send_message] Error getting assistant: {}", e),
            }
        } else {
            println!("✅ [send_message] Assistant already exists as participant");
        }
    } else if let Some(model_id) = &model_db_id {
        // Add model if the SPECIFIC one is not present
        if !current_model_exists {
            println!(
                "🤖 [send_message] Adding NEW model as participant (model_id: {})...",
                model_id
            );
            match state.db.get_model(model_id) {
                Ok(Some(model)) => {
                    match state.db.add_conversation_participant(
                        CreateConversationParticipantRequest {
                            conversation_id: conversation_id.clone(),
                            participant_type: "model".to_string(),
                            participant_id: Some(model.id.clone()),
                            display_name: Some(model.name.clone()),
                        },
                    ) {
                        Ok(_) => println!(
                            "✅ [send_message] Added model '{}' as participant",
                            model.name
                        ),
                        Err(e) => println!("⚠️  [send_message] Failed to add model: {}", e),
                    }
                }
                Ok(None) => println!("⚠️  [send_message] Model not found: {}", model_id),
                Err(e) => println!("⚠️  [send_message] Error getting model: {}", e),
            }
        } else {
            println!("✅ [send_message] Model already exists as participant");
        }
    }

    // Create cancellation token for this generation
    let cancel_token = CancellationToken::new();

    // Register the cancellation token
    {
        let mut tasks = state.generation_tasks.write().await;
        tasks.insert(conversation_id.clone(), cancel_token.clone());
    }

    // Spawn background task to process LLM request
    // This allows the command to return immediately and multiple requests to process concurrently
    println!("🔄 [send_message] Spawning background task...");
    let state_clone = state.inner().clone();
    let user_message_id = user_message.id.clone();
    let app_clone = app.clone();
    let conversation_id_clone = conversation_id.clone();
    let model_db_id = model_db_id.clone();
    let assistant_db_id = assistant_db_id.clone();

    // Clone urls_to_fetch, images, files, and search_enabled for the background task
    let urls_to_fetch_clone = urls_to_fetch.clone();
    let images_clone = images.clone();
    let files_clone = files.clone();
    let search_enabled_clone = search_enabled.unwrap_or(false);

    tokio::spawn(async move {
        println!("🎯 [background_task] Started processing LLM request");

        // Track search result ID for linking fetch results
        let mut search_result_id: Option<String> = None;

        // If search is enabled, first ask AI if search is actually needed
        let urls: Vec<String> = if search_enabled_clone {
            println!("🔍 [background_task] Web search enabled, checking if search is needed...");

            // Emit event to show "deciding" state immediately
            let _ = app_clone.emit(
                "search-decision-started",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id_clone,
                }),
            );

            // Use AI to decide if search is truly needed
            let decision = match crate::web_search::decide_search_needed(
                &content,
                &provider,
                &model,
                api_key.as_deref(),
                base_url.as_deref(),
            )
            .await
            {
                Ok(d) => d,
                Err(e) => {
                    eprintln!(
                        "⚠️ [background_task] Search decision failed, skipping search: {}",
                        e
                    );
                    crate::web_search::SearchDecisionResult {
                        reasoning: format!("Decision failed: {}", e),
                        search_needed: false,
                        search_query: None,
                    }
                }
            };

            // Store the search decision in database (as a process step)
            match state_clone
                .db
                .create_search_decision(CreateSearchDecisionRequest {
                    reasoning: decision.reasoning.clone(),
                    search_needed: decision.search_needed,
                    search_query: decision.search_query.clone(),
                    search_result_id: None, // Will be updated if search is performed
                }) {
                Ok(search_decision) => {
                    println!(
                        "📝 [background_task] Created search decision: {}",
                        search_decision.id
                    );

                    // Link to user message as a process step
                    if let Err(e) = state_clone.db.link_message_step(
                        &user_message_id,
                        StepType::SearchDecision,
                        &search_decision.id,
                        Some(0),
                    ) {
                        eprintln!("Failed to link search decision to message: {}", e);
                    }

                    // Emit step update for UI
                    let _ = app_clone.emit(
                        "step-update",
                        serde_json::json!({
                            "message_id": user_message_id,
                            "conversation_id": conversation_id_clone,
                        }),
                    );
                }
                Err(e) => {
                    eprintln!(
                        "❌ [background_task] Failed to create search decision: {}",
                        e
                    );
                }
            }

            if decision.search_needed {
                // Use AI-generated search query (better optimized than raw user input)
                let keywords = decision
                    .search_query
                    .unwrap_or_else(|| crate::web_search::extract_search_keywords(&content));
                println!(
                    "🔍 [background_task] AI decided search is needed, query: {}",
                    keywords
                );

                // Create SearchResult IMMEDIATELY (before searching) so UI can show it
                let searched_at = chrono::Utc::now().to_rfc3339();
                match state_clone
                    .db
                    .create_search_result(CreateSearchResultRequest {
                        query: keywords.clone(),
                        engine: "duckduckgo".to_string(),
                        total_results: None, // Will be updated after search completes
                        searched_at: searched_at.clone(),
                    }) {
                    Ok(search_result) => {
                        println!(
                            "📝 [background_task] Created pending search result: {}",
                            search_result.id
                        );
                        search_result_id = Some(search_result.id.clone());

                        // Link search result to message as context enrichment
                        if let Err(e) = state_clone.db.link_message_context(
                            &user_message_id,
                            ContextType::SearchResult,
                            &search_result.id,
                            Some(0), // First context item
                        ) {
                            eprintln!("Failed to link search result to message: {}", e);
                        }

                        // Emit attachment update so UI shows SearchPreview immediately
                        let _ = app_clone.emit(
                            "attachment-update",
                            serde_json::json!({
                                "message_id": user_message_id,
                                "conversation_id": conversation_id_clone,
                                "attachment": {
                                    "type": "search_result",
                                    "id": search_result.id,
                                    "query": keywords,
                                    "engine": "duckduckgo",
                                    "total_results": null,
                                    "searched_at": searched_at,
                                }
                            }),
                        );
                    }
                    Err(e) => {
                        eprintln!("Failed to create search result: {}", e);
                    }
                }

                // Now perform the actual search
                match crate::web_search::search_duckduckgo(&keywords, 5).await {
                    Ok(search_response) => {
                        println!(
                            "✅ [background_task] Search completed, found {} results",
                            search_response.results.len()
                        );

                        // Update SearchResult with actual results count
                        if let Some(ref sr_id) = search_result_id {
                            if let Err(e) = state_clone.db.update_search_result_total(
                                sr_id,
                                search_response.total_results as i64,
                            ) {
                                eprintln!("Failed to update search result total: {}", e);
                            }

                            // Emit attachment-update so frontend shows result count immediately
                            let _ = app_clone.emit(
                                "attachment-update",
                                serde_json::json!({
                                    "message_id": user_message_id,
                                    "conversation_id": conversation_id_clone,
                                    "attachment": {
                                        "type": "search_result",
                                        "id": sr_id,
                                        "query": search_response.query,
                                        "engine": "duckduckgo",
                                        "total_results": search_response.total_results,
                                    }
                                }),
                            );
                        }

                        // Emit search completed event
                        let search_urls: Vec<String> = search_response
                            .results
                            .iter()
                            .map(|r| r.url.clone())
                            .collect();
                        let _ = app_clone.emit(
                            "search-completed",
                            serde_json::json!({
                                "message_id": user_message_id,
                                "conversation_id": conversation_id_clone,
                                "search_result_id": search_result_id,
                                "query": search_response.query,
                                "results_count": search_response.results.len(),
                            }),
                        );

                        search_urls
                    }
                    Err(e) => {
                        eprintln!("❌ [background_task] Search failed: {}", e);
                        // Fall back to explicitly provided URLs only (from webpage attachments)
                        urls_to_fetch_clone.unwrap_or_default()
                    }
                }
            } else {
                println!(
                    "ℹ️ [background_task] AI decided search is NOT needed: {}",
                    decision.reasoning
                );
                // No search needed, use explicitly provided URLs only (from webpage attachments)
                urls_to_fetch_clone.unwrap_or_default()
            }
        } else {
            // Search not enabled, use explicitly provided URLs only (from webpage attachments)
            urls_to_fetch_clone.unwrap_or_default()
        };

        println!("🔍 [background_task] Processing {} URLs", urls.len());
        if !urls.is_empty() {
            let _ = app_clone.emit(
                "attachment-processing-started",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id_clone,
                    "urls": urls,
                }),
            );
        }

        // Process URLs with streaming - results are sent one by one as they complete
        let (mut rx, fetch_handle) = web_fetch::fetch_urls_with_channel(&urls, None).await;

        // Collect fetched resources and process each as it arrives
        let mut fetched_resources: Vec<web_fetch::FetchedWebResource> = Vec::new();
        let mut attachment_ids: Vec<String> = Vec::new();

        // Process each result as it arrives from the channel
        while let Some(resource) = rx.recv().await {
            // Generate storage path and save content to filesystem
            let fetch_id = uuid::Uuid::now_v7().to_string();
            let storage_path =
                crate::storage::generate_fetch_storage_path(&fetch_id, &resource.content_format);

            // Save content to filesystem
            if let Err(e) =
                crate::storage::write_content(&app_clone, &storage_path, &resource.content)
            {
                eprintln!(
                    "Failed to save content to filesystem for {}: {}",
                    resource.url, e
                );
                fetched_resources.push(resource);
                continue;
            }

            let status = if resource.extraction_error.is_some() {
                "failed"
            } else {
                "success"
            };
            let headings_json = serde_json::to_string(&resource.metadata.headings).ok();
            let content_size = resource.content.len() as i64;

            // Determine source type: if we have a search_result_id, it's from search; otherwise from user
            let (source_type, source_id) = if search_result_id.is_some() {
                ("search".to_string(), search_result_id.clone())
            } else {
                ("user_link".to_string(), None)
            };

            match state_clone
                .db
                .create_fetch_result(CreateFetchResultRequest {
                    source_type: Some(source_type),
                    source_id: source_id,
                    url: resource.url.clone(),
                    title: resource.title.clone(),
                    description: resource.description.clone(),
                    storage_path: storage_path.clone(),
                    content_type: resource.content_format.clone(),
                    original_mime: Some(resource.mime_type.clone()),
                    status: Some(status.to_string()),
                    error: resource.extraction_error.clone(),
                    keywords: resource.metadata.keywords.clone(),
                    headings: headings_json,
                    original_size: resource.metadata.original_length.map(|l| l as i64),
                    processed_size: Some(content_size),
                    favicon_url: resource.metadata.favicon_url.clone(),
                }) {
                Ok(fetch_result) => {
                    // Link fetch_result to message as context enrichment
                    if let Err(e) = state_clone.db.link_message_context(
                        &user_message_id,
                        ContextType::FetchResult,
                        &fetch_result.id,
                        None,
                    ) {
                        eprintln!("Failed to link fetch_result to message: {}", e);
                    }

                    // Emit attachment-update immediately so UI shows this result
                    let _ = app_clone.emit(
                        "attachment-update",
                        serde_json::json!({
                            "message_id": user_message_id,
                            "conversation_id": conversation_id_clone,
                            "attachment_id": fetch_result.id,
                            "completed_url": resource.url,
                        }),
                    );

                    attachment_ids.push(fetch_result.id);
                }
                Err(e) => {
                    eprintln!("Failed to create fetch_result for {}: {}", resource.url, e);
                    // Clean up saved file on failure
                    let _ = crate::storage::delete_file(&app_clone, &storage_path);
                }
            }

            fetched_resources.push(resource);
        }

        // Wait for all fetches to complete
        let _ = fetch_handle.await;

        println!(
            "📄 [background_task] Fetched {} web resources",
            fetched_resources.len()
        );

        // Emit attachment processing complete event with attachment IDs
        if !urls.is_empty() {
            let _ = app_clone.emit(
                "attachment-processing-complete",
                serde_json::json!({
                    "message_id": user_message_id,
                    "conversation_id": conversation_id_clone,
                    "attachment_ids": attachment_ids,
                }),
            );
        }

        // Build LLM content by combining original message with fetched content
        let processed_content =
            web_fetch::build_llm_content_with_attachments(&content, &fetched_resources);

        // Parse image attachments from ImageAttachmentInput
        let mut user_images: Vec<(String, llm::ImageData)> = Vec::new(); // (name, data)
        if let Some(images) = images_clone {
            if !images.is_empty() {
                println!(
                    "🖼️  [background_task] Processing {} image attachments",
                    images.len()
                );
                for img in images.iter() {
                    // Parse data URL: "data:image/png;base64,xxxxx"
                    if let Some(rest) = img.base64.strip_prefix("data:") {
                        if let Some((media_type, base64_data)) = rest.split_once(";base64,") {
                            user_images.push((
                                img.name.clone(),
                                llm::ImageData {
                                    base64: base64_data.to_string(),
                                    media_type: media_type.to_string(),
                                },
                            ));
                            println!(
                                "   - Parsed image: {} - {} ({} chars)",
                                img.name,
                                media_type,
                                base64_data.len()
                            );
                        }
                    }
                }
            }
        }

        // Convert file attachments to FileData
        let mut user_files: Vec<llm::FileData> = Vec::new();
        if let Some(files) = files_clone {
            if !files.is_empty() {
                println!(
                    "📄 [background_task] Processing {} file attachments",
                    files.len()
                );
                for file in files.iter() {
                    user_files.push(llm::FileData {
                        name: file.name.clone(),
                        content: file.content.clone(),
                        media_type: file.mime_type.clone(),
                    });
                    println!(
                        "   - File: {} ({} chars, {})",
                        file.name,
                        file.content.len(),
                        file.mime_type
                    );
                }
            }
        }

        // Store file attachments to filesystem and database
        for file in &user_files {
            let file_id = uuid::Uuid::now_v7().to_string();

            // Get extension from filename
            let ext = std::path::Path::new(&file.name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("txt");

            let storage_path = crate::storage::generate_file_storage_path(&file_id, ext);

            // Write file content to filesystem
            if let Err(e) = crate::storage::write_content(&app_clone, &storage_path, &file.content)
            {
                eprintln!("Failed to save file {}: {}", file.name, e);
                continue;
            }

            // Create file record in database
            match state_clone
                .db
                .create_file_attachment(CreateFileAttachmentRequest {
                    file_name: file.name.clone(),
                    file_size: file.content.len() as i64,
                    mime_type: file.media_type.clone(),
                    storage_path: storage_path.clone(),
                }) {
                Ok(file_attachment) => {
                    // Link file to message (user attachment)
                    if let Err(e) = state_clone.db.link_message_attachment(
                        &user_message_id,
                        UserAttachmentType::File,
                        &file_attachment.id,
                        None,
                    ) {
                        eprintln!("Failed to link file to message: {}", e);
                    } else {
                        println!(
                            "📎 [background_task] Saved file attachment: {} -> {}",
                            file.name, file_attachment.id
                        );

                        // Emit attachment-update so UI refreshes and shows the file
                        let _ = app_clone.emit(
                            "attachment-update",
                            serde_json::json!({
                                "message_id": user_message_id,
                                "conversation_id": conversation_id_clone,
                                "attachment_id": file_attachment.id,
                            }),
                        );
                    }
                }
                Err(e) => {
                    eprintln!("Failed to create file record for {}: {}", file.name, e);
                    let _ = crate::storage::delete_file(&app_clone, &storage_path);
                }
            }
        }

        // Store image attachments to filesystem and database
        for (file_name, img) in user_images.iter() {
            let file_id = uuid::Uuid::now_v7().to_string();

            // Get extension from mime type
            let ext = crate::storage::get_extension_for_content_type(&img.media_type);
            let storage_path = crate::storage::generate_file_storage_path(&file_id, ext);

            // Decode base64 to bytes
            let bytes = match base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                &img.base64,
            ) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("Failed to decode image {}: {}", file_name, e);
                    continue;
                }
            };

            // Write image to filesystem
            if let Err(e) = crate::storage::write_binary(&app_clone, &storage_path, &bytes) {
                eprintln!("Failed to save image {}: {}", file_name, e);
                continue;
            }

            // Create file record in database with original filename
            match state_clone
                .db
                .create_file_attachment(CreateFileAttachmentRequest {
                    file_name: file_name.clone(),
                    file_size: bytes.len() as i64,
                    mime_type: img.media_type.clone(),
                    storage_path: storage_path.clone(),
                }) {
                Ok(file_attachment) => {
                    // Link file (image) to message (user attachment)
                    if let Err(e) = state_clone.db.link_message_attachment(
                        &user_message_id,
                        UserAttachmentType::File,
                        &file_attachment.id,
                        None,
                    ) {
                        eprintln!("Failed to link image to message: {}", e);
                    } else {
                        println!(
                            "🖼️ [background_task] Saved image attachment: {} -> {}",
                            file_name, file_attachment.id
                        );

                        // Emit attachment-update so UI refreshes and shows the image
                        let _ = app_clone.emit(
                            "attachment-update",
                            serde_json::json!({
                                "message_id": user_message_id,
                                "conversation_id": conversation_id_clone,
                                "attachment_id": file_attachment.id,
                            }),
                        );
                    }
                }
                Err(e) => {
                    eprintln!("Failed to create file record for image {}: {}", file_name, e);
                    let _ = crate::storage::delete_file(&app_clone, &storage_path);
                }
            }
        }

        // Build chat messages with system prompt
        // Use assistant's system prompt if provided, otherwise use default
        let system_prompt_content =
            system_prompt.unwrap_or_else(|| prompts::DEFAULT_ASSISTANT_SYSTEM_PROMPT.to_string());

        let mut chat_messages = vec![ChatMessage {
            role: "system".to_string(),
            content: system_prompt_content,
            images: vec![],
            files: vec![],
        }];

        // Include message history if requested (default: true)
        let should_include_history = include_history.unwrap_or(true);
        if should_include_history {
            if let Ok(messages) = state_clone
                .db
                .list_messages_by_conversation(&conversation_id_clone)
            {
                for msg in messages.iter() {
                    // Skip the user message we just saved (it will be added with processed content below)
                    if msg.id == user_message_id {
                        continue;
                    }
                    // Map sender_type to chat role (user -> user, model/assistant -> assistant)
                    let chat_role = match msg.sender_type.as_str() {
                        "user" => "user",
                        "model" | "assistant" => "assistant",
                        _ => continue, // Skip unknown types
                    };
                    chat_messages.push(ChatMessage {
                        role: chat_role.to_string(),
                        content: msg.content.clone(),
                        images: vec![], // History messages don't have images stored
                        files: vec![],  // History messages don't have files stored
                    });
                }
            }
        }

        // Always add the current user message with processed content (URL fetching done)
        // If user_prompt is provided (from assistant), prepend it to the content
        let final_user_content = if let Some(ref prompt) = user_prompt {
            format!("{}\n\n{}", prompt, processed_content)
        } else {
            processed_content.clone()
        };

        // Extract just the ImageData for LLM (dropping filenames which were used for storage)
        let llm_images: Vec<llm::ImageData> = user_images.into_iter().map(|(_, img)| img).collect();

        chat_messages.push(ChatMessage {
            role: "user".to_string(),
            content: final_user_content,
            images: llm_images,
            files: user_files,
        });

        // Send chat request with streaming (unified handler for all providers)
        println!(
            "📤 [background_task] Sending chat request to LLM (model: {})",
            model
        );
        handle_provider_streaming(
            provider,
            model,
            chat_messages,
            api_key,
            base_url,
            cancel_token,
            state_clone,
            app,
            conversation_id_clone,
            content,
            model_db_id,
            assistant_db_id,
        )
        .await;
    });

    // Return user message immediately
    Ok(user_message)
}

// Stop generation command
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

        // Emit event to notify frontend that generation was stopped
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

// ========== Web Search Commands ==========

/// Perform a DuckDuckGo web search
#[tauri::command]
pub async fn perform_web_search(
    query: String,
    max_results: Option<usize>,
) -> Result<crate::web_search::DuckDuckGoSearchResponse, String> {
    let max = max_results.unwrap_or(5);
    println!(
        "🔍 [perform_web_search] Searching for: {} (max {})",
        query, max
    );

    crate::web_search::search_duckduckgo(&query, max)
        .await
        .map_err(|e| e.to_string())
}

/// Extract search keywords from user input
#[tauri::command]
pub async fn extract_search_keywords(user_input: String) -> Result<String, String> {
    Ok(crate::web_search::extract_search_keywords(&user_input))
}
