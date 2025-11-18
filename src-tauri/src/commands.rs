use tauri::{State, Emitter};
use crate::db::Database;
use crate::models::*;
use crate::crypto;
use crate::llm::{self, ChatRequest, ChatMessage};
use crate::scraper;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
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
pub async fn list_providers(
    state: State<'_, AppState>,
) -> Result<Vec<Provider>, String> {
    state.db.list_providers().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    req: CreateProviderRequest,
) -> Result<Provider, String> {
    state.db.update_provider(&id, req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_provider(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
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
pub async fn get_model(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Model>, String> {
    state.db.get_model(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, AppState>,
) -> Result<Vec<Model>, String> {
    state.db.list_models().map_err(|e| e.to_string())
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
pub async fn delete_model(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.db.delete_model(&id).map_err(|e| e.to_string())
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
pub async fn list_assistants(
    state: State<'_, AppState>,
) -> Result<Vec<Assistant>, String> {
    state.db.list_assistants().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_assistant(
    state: State<'_, AppState>,
    id: String,
    req: CreateAssistantRequest,
) -> Result<Assistant, String> {
    state.db.update_assistant(&id, req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_assistant(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
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
pub async fn get_user(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<User>, String> {
    state.db.get_user(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_self_user(
    state: State<'_, AppState>,
) -> Result<Option<User>, String> {
    state.db.get_self_user().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_users(
    state: State<'_, AppState>,
) -> Result<Vec<User>, String> {
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
pub async fn list_conversations(
    state: State<'_, AppState>,
) -> Result<Vec<Conversation>, String> {
    state.db.list_conversations().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_conversation(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<Conversation, String> {
    state.db.update_conversation(&id, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_conversation(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.db.delete_conversation(&id).map_err(|e| e.to_string())
}

// Conversation Participant commands
#[tauri::command]
pub async fn add_conversation_participant(
    state: State<'_, AppState>,
    req: CreateConversationParticipantRequest,
) -> Result<ConversationParticipant, String> {
    state.db.add_conversation_participant(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_conversation_participants(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<ConversationParticipant>, String> {
    state.db.list_conversation_participants(&conversation_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_conversation_participant_summary(
    state: State<'_, AppState>,
    conversation_id: String,
    current_user_id: String,
) -> Result<Vec<ParticipantSummary>, String> {
    state.db.get_conversation_participant_summary(&conversation_id, &current_user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_conversation_participant(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.db.remove_conversation_participant(&id).map_err(|e| e.to_string())
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
    state.db.list_messages_by_conversation(&conversation_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_messages_by_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    state.db.delete_messages_in_conversation(&conversation_id).map_err(|e| e.to_string())
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
    state.db.set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_settings(
    state: State<'_, AppState>,
) -> Result<Vec<Setting>, String> {
    state.db.get_all_settings().map_err(|e| e.to_string())
}

// Crypto commands
#[tauri::command]
pub async fn generate_keypair() -> Result<crypto::GeneratedKeyPair, String> {
    crypto::generate_keypair().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_keypair(
    public_key: String,
    private_key: String,
) -> Result<String, String> {
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
    let summary_model_id = state.db.get_setting("conversation_summary_model_id")
        .ok()
        .flatten();
    
    let (summary_provider, summary_model, summary_api_key, summary_base_url) = if let Some(model_id) = summary_model_id {
        // Get the custom model settings
        match state.db.get_model(&model_id) {
            Ok(Some(m)) => {
                // Get provider info
                match state.db.get_provider(&m.provider_id) {
                    Ok(Some(p)) => {
                        println!("🏷️ [generate_title] Using custom summary model: {} from provider: {}", m.model_id, p.provider_type);
                        (p.provider_type.clone(), m.model_id.clone(), p.api_key.clone(), p.base_url.clone())
                    },
                    _ => {
                        println!("🏷️ [generate_title] Custom model provider not found, using current model");
                        (provider.to_string(), model.to_string(), api_key.clone(), base_url.clone())
                    }
                }
            },
            _ => {
                println!("🏷️ [generate_title] Custom model not found, using current model");
                (provider.to_string(), model.to_string(), api_key.clone(), base_url.clone())
            }
        }
    } else {
        // Use the current conversation model by default
        println!("🏷️ [generate_title] No custom summary model set, using current model");
        (provider.to_string(), model.to_string(), api_key.clone(), base_url.clone())
    };
    
    // Create the title generation prompt
    let title_prompt = format!(
        "You are an expert at creating concise conversation titles. Summarize the following conversation into a title within 8 words. Use the same language as the user's message. Do not include punctuation or special symbols.\n\nUser: {}\n\nAssistant: {}",
        user_message,
        assistant_message
    );
    
    // Generate title using rig providers
    let response = match summary_provider.as_str() {
        "openai_rig" | "openai" => {
            let api_key_val = summary_api_key.ok_or_else(|| anyhow::anyhow!("OpenAI API key required"))?;
            let provider = llm::openai_rig::OpenAIRigProvider::new(api_key_val);
            let request = ChatRequest {
                model: summary_model,
                messages: vec![ChatMessage {
                    role: "user".to_string(),
                    content: title_prompt.clone(),
                }],
                stream: false,
            };
            let cancel_token = tokio_util::sync::CancellationToken::new();
            provider.chat_stream(request, cancel_token, |_| true).await?
        }
        "openrouter_rig" | "openrouter" => {
            let api_key_val = summary_api_key.ok_or_else(|| anyhow::anyhow!("OpenRouter API key required"))?;
            let provider = llm::openrouter_rig::OpenRouterRigProvider::new(api_key_val);
            let request = ChatRequest {
                model: summary_model,
                messages: vec![ChatMessage {
                    role: "user".to_string(),
                    content: title_prompt.clone(),
                }],
                stream: false,
            };
            let cancel_token = tokio_util::sync::CancellationToken::new();
            provider.chat_stream(request, cancel_token, |_| true).await?
        }
        "ollama_rig" | "ollama" => {
            let provider = llm::ollama_rig::OllamaRigProvider::new(summary_base_url);
            let request = ChatRequest {
                model: summary_model,
                messages: vec![ChatMessage {
                    role: "user".to_string(),
                    content: title_prompt.clone(),
                }],
                stream: false,
            };
            let cancel_token = tokio_util::sync::CancellationToken::new();
            provider.chat_stream(request, cancel_token, |_| true).await?
        }
        _ => {
            return Err(anyhow::anyhow!("Unknown provider: {}. Use openai_rig, openrouter_rig, or ollama_rig", summary_provider));
        }
    };
    
    // Clean up the title (remove quotes, extra whitespace, etc.)
    let title = response.content.trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '.' || c == ',' || c == '!' || c == '?')
        .trim()
        .to_string();
    
    println!("🏷️ [generate_title] Generated title: {}", title);
    Ok(title)
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
            thinking_content: None,
            tokens: None,
        })
        .map_err(|e| {
            println!("❌ [send_message] Failed to create message: {}", e);
            e.to_string()
        })?;
    
    println!("✅ [send_message] User message created with id: {}", user_message.id);

    // Auto-add participants - supports multiple models/assistants in same conversation
    // This ensures conversation_participants table is populated for UI display
    let existing_participants = state.db
        .list_conversation_participants(&conversation_id)
        .map_err(|e| e.to_string())?;
    
    // Check if we need to add participants
    let has_user = existing_participants.iter().any(|p| p.participant_type == "user");
    
    // Check if the SPECIFIC model or assistant is already a participant
    let current_model_exists = if let Some(ref model_id) = model_db_id {
        existing_participants.iter().any(|p| 
            p.participant_type == "model" && 
            p.participant_id.as_ref() == Some(model_id)
        )
    } else {
        false
    };
    
    let current_assistant_exists = if let Some(ref assistant_id) = assistant_db_id {
        existing_participants.iter().any(|p| 
            p.participant_type == "assistant" && 
            p.participant_id.as_ref() == Some(assistant_id)
        )
    } else {
        false
    };
    
    println!("📋 [send_message] Current participants: {} total", existing_participants.len());
    println!("   has_user: {}", has_user);
    println!("   current_model_exists: {} (model_db_id: {:?})", current_model_exists, model_db_id);
    println!("   current_assistant_exists: {} (assistant_db_id: {:?})", current_assistant_exists, assistant_db_id);
    
    // Add self user if not present
    if !has_user {
        println!("👤 [send_message] Adding self user as participant...");
        match state.db.get_self_user() {
            Ok(Some(self_user)) => {
                match state.db.add_conversation_participant(
                    CreateConversationParticipantRequest {
                        conversation_id: conversation_id.clone(),
                        participant_type: "user".to_string(),
                        participant_id: Some(self_user.id.clone()),
                        display_name: Some(self_user.display_name.clone()),
                    }
                ) {
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
            println!("🤖 [send_message] Adding NEW assistant as participant (assistant_id: {})...", assistant_id);
            match state.db.get_assistant(assistant_id) {
                Ok(Some(assistant)) => {
                    match state.db.add_conversation_participant(
                        CreateConversationParticipantRequest {
                            conversation_id: conversation_id.clone(),
                            participant_type: "assistant".to_string(),
                            participant_id: Some(assistant.id.clone()),
                            display_name: Some(assistant.name.clone()),
                        }
                    ) {
                        Ok(_) => println!("✅ [send_message] Added assistant '{}' as participant", assistant.name),
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
            println!("🤖 [send_message] Adding NEW model as participant (model_id: {})...", model_id);
            match state.db.get_model(model_id) {
                Ok(Some(model)) => {
                    match state.db.add_conversation_participant(
                        CreateConversationParticipantRequest {
                            conversation_id: conversation_id.clone(),
                            participant_type: "model".to_string(),
                            participant_id: Some(model.id.clone()),
                            display_name: Some(model.name.clone()),
                        }
                    ) {
                        Ok(_) => println!("✅ [send_message] Added model '{}' as participant", model.name),
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
    
    tokio::spawn(async move {
        println!("🎯 [background_task] Started processing LLM request");
        // Check if message contains URLs and emit scraping started event
        let urls = scraper::extract_urls(&content);
        println!("🔍 [background_task] Found {} URLs", urls.len());
        if !urls.is_empty() {
            let _ = app_clone.emit("scraping-started", serde_json::json!({
                "message_id": user_message_id,
                "conversation_id": conversation_id_clone,
            }));
        }
        
        // Process URLs in background (not blocking the command return)
        let processed_content = match scraper::process_message_with_urls(&content).await {
            Ok((full_content, scraped_only)) => {
                // Emit scraping complete event
                if !urls.is_empty() {
                    let _ = app_clone.emit("scraping-complete", serde_json::json!({
                        "message_id": user_message_id,
                        "conversation_id": conversation_id_clone,
                        "scraped_content": scraped_only,
                    }));
                }
                full_content
            },
            Err(e) => {
                eprintln!("Failed to process URLs: {}, using original", e);
                // Emit scraping error event
                if !urls.is_empty() {
                    let _ = app_clone.emit("scraping-error", serde_json::json!({
                        "message_id": user_message_id,
                        "conversation_id": conversation_id_clone,
                        "error": e.to_string(),
                    }));
                }
                content.clone()
            }
        };
        
        // Build chat messages with system prompt
        // Use assistant's system prompt if provided, otherwise use default
        let system_prompt_content = system_prompt
            .unwrap_or_else(|| "You are a helpful, harmless, and honest AI assistant.".to_string());
        
        let mut chat_messages = vec![ChatMessage {
            role: "system".to_string(),
            content: system_prompt_content,
        }];

        // Include message history if requested (default: true)
        let should_include_history = include_history.unwrap_or(true);
        if should_include_history {
            if let Ok(messages) = state_clone.db.list_messages_by_conversation(&conversation_id_clone) {
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
        
        chat_messages.push(ChatMessage {
            role: "user".to_string(),
            content: final_user_content,
        });

        // Handle ollama_rig separately as it uses a different API pattern
        if provider == "ollama_rig" {
            println!("✅ [background_task] Using Ollama Rig provider with base_url: {:?}", base_url);
            
            let ollama_provider = llm::ollama_rig::OllamaRigProvider::new(base_url.clone());
            
            // Send chat request with streaming
            println!("📤 [background_task] Sending chat request to LLM (model: {})", model);
            let request = ChatRequest {
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
            
            let response = match ollama_provider
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
            {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("LLM request failed: {}", e);
                    let mut tasks = state_clone.generation_tasks.write().await;
                    tasks.remove(&conversation_id_clone);
                    return;
                }
            };
            
            // Use response content directly (already handles cancellation internally)
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
                thinking_content: response.thinking_content,
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
            
            println!("✅ [background_task] Assistant message saved with id: {}", assistant_message.id);
            
            // Notify frontend that streaming is complete
            let completion_payload = serde_json::json!({
                "conversation_id": conversation_id_clone,
                "message": assistant_message,
            });
            let _ = app.emit("chat-complete", completion_payload);
            
            // Remove task from tracking
            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            
            return;
        }
        
        // Handle openrouter_rig separately as it uses a different API pattern
        if provider == "openrouter_rig" {
            println!("✅ [background_task] Using OpenRouter Rig provider");
            
            let api_key_val = match api_key.clone() {
                Some(k) => k,
                None => {
                    eprintln!("❌ [background_task] OpenRouter API key required");
                    let mut tasks = state_clone.generation_tasks.write().await;
                    tasks.remove(&conversation_id_clone);
                    return;
                }
            };
            
            let openrouter_provider = llm::openrouter_rig::OpenRouterRigProvider::new(api_key_val);
            
            // Send chat request with streaming
            println!("📤 [background_task] Sending chat request to LLM (model: {})", model);
            let request = ChatRequest {
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
            
            let response = match openrouter_provider
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
            {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("LLM request failed: {}", e);
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
                thinking_content: response.thinking_content,
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
            
            println!("✅ [background_task] Assistant message saved with id: {}", assistant_message.id);
            
            // Notify frontend that streaming is complete
            let completion_payload = serde_json::json!({
                "conversation_id": conversation_id_clone,
                "message": assistant_message,
            });
            let _ = app.emit("chat-complete", completion_payload);
            
            // Remove task from tracking
            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            
            return;
        }
        
        // Handle openai_rig separately as it uses a different API pattern
        if provider == "openai_rig" {
            println!("✅ [background_task] Using OpenAI Rig provider");
            
            let api_key_val = match api_key.clone() {
                Some(k) => k,
                None => {
                    eprintln!("❌ [background_task] OpenAI API key required");
                    let mut tasks = state_clone.generation_tasks.write().await;
                    tasks.remove(&conversation_id_clone);
                    return;
                }
            };
            
            let openai_provider = llm::openai_rig::OpenAIRigProvider::new(api_key_val);
            
            // Send chat request with streaming
            println!("📤 [background_task] Sending chat request to LLM (model: {})", model);
            let request = ChatRequest {
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
            
            let response = match openai_provider
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
            {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("LLM request failed: {}", e);
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
                thinking_content: response.thinking_content,
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
            
            println!("✅ [background_task] Assistant message saved with id: {}", assistant_message.id);
            
            // Notify frontend that streaming is complete
            let completion_payload = serde_json::json!({
                "conversation_id": conversation_id_clone,
                "message": assistant_message,
            });
            let _ = app.emit("chat-complete", completion_payload);
            
            // Remove task from tracking
            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            
            return;
        }
        
        // Unknown provider - clean up and exit
        eprintln!("❌ [background_task] Unknown provider: {}. Available providers: openai_rig, openrouter_rig, ollama_rig", provider);
        
        // Remove task from tracking
        let mut tasks = state_clone.generation_tasks.write().await;
        tasks.remove(&conversation_id_clone);
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
    println!("🛑 [stop_generation] Stopping generation for conversation: {}", conversation_id);
    
    let tasks = state.generation_tasks.read().await;
    
    if let Some(cancel_token) = tasks.get(&conversation_id) {
        cancel_token.cancel();
        println!("✅ [stop_generation] Cancellation token triggered");
        
        // Emit event to notify frontend that generation was stopped
        let _ = app.emit("generation-stopped", serde_json::json!({
            "conversation_id": conversation_id,
        }));
        
        Ok(true)
    } else {
        println!("⚠️ [stop_generation] No active task found for conversation");
        Ok(false)
    }
}

