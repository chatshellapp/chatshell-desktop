use tauri::{State, Emitter};
use crate::db::Database;
use crate::models::*;
use crate::crypto;
use crate::llm::{self, LLMProvider, ChatRequest, ChatMessage};
use crate::scraper;
use anyhow::Result;

pub use crate::llm::models::ModelInfo;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
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
    
    // Create LLM provider
    let llm_provider: Box<dyn LLMProvider> = match summary_provider.as_str() {
        "openai" => {
            if let Some(k) = summary_api_key {
                Box::new(llm::openai::OpenAIProvider::new(k))
            } else {
                return Err(anyhow::anyhow!("OpenAI API key required"));
            }
        }
        "openrouter" => {
            if let Some(k) = summary_api_key {
                Box::new(llm::openrouter::OpenRouterProvider::new(k))
            } else {
                return Err(anyhow::anyhow!("OpenRouter API key required"));
            }
        }
        "ollama" => {
            Box::new(llm::ollama::OllamaProvider::new(summary_base_url))
        },
        _ => {
            return Err(anyhow::anyhow!("Unknown provider: {}", summary_provider));
        }
    };
    
    // Create chat request for title generation
    let request = ChatRequest {
        model: summary_model,
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: title_prompt,
        }],
        stream: false,
    };
    
    // Call LLM (using chat_stream with empty callback since we don't need streaming for this)
    let response = llm_provider.chat_stream(request, Box::new(|_| {})).await?;
    
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
) -> Result<Message, String> {
    println!("🚀 [send_message] Command received!");
    println!("   conversation_id: {}", conversation_id);
    println!("   content: {}", content);
    println!("   provider: {}", provider);
    println!("   model: {}", model);
    println!("   base_url: {:?}", base_url);
    
    // Save user message to database with original content first
    // URL processing will happen in background
    println!("📝 [send_message] Creating user message in database...");
    let user_message = state
        .db
        .create_message(CreateMessageRequest {
            conversation_id: Some(conversation_id.clone()),
            sender_type: "user".to_string(),
            sender_id: None,
            role: "user".to_string(),
            content: content.clone(),
            thinking_content: None,
            tokens: None,
        })
        .map_err(|e| {
            println!("❌ [send_message] Failed to create message: {}", e);
            e.to_string()
        })?;
    
    println!("✅ [send_message] User message created with id: {}", user_message.id);

    // Spawn background task to process LLM request
    // This allows the command to return immediately and multiple requests to process concurrently
    println!("🔄 [send_message] Spawning background task...");
    let state_clone = state.inner().clone();
    let user_message_id = user_message.id.clone();
    let app_clone = app.clone();
    let conversation_id_clone = conversation_id.clone();
    
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
        
        // Build chat messages with a default system prompt
        // In the new architecture, we don't rely on assistants anymore
        let mut chat_messages = vec![ChatMessage {
            role: "system".to_string(),
            content: "You are a helpful, harmless, and honest AI assistant.".to_string(),
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
                    if msg.role != "system" {
                        chat_messages.push(ChatMessage {
                            role: msg.role.clone(),
                            content: msg.content.clone(),
                        });
                    }
                }
            }
        }
        
        // Always add the current user message with processed content (URL fetching done)
        chat_messages.push(ChatMessage {
            role: "user".to_string(),
            content: processed_content.clone(),
        });

        // Create LLM provider directly from parameters
        println!("🤖 [background_task] Creating LLM provider: {}", provider);
        let llm_provider: Box<dyn LLMProvider> = match provider.as_str() {
            "openai" => {
                if let Some(k) = api_key.clone() {
                    println!("✅ [background_task] Created OpenAI provider");
                    Box::new(llm::openai::OpenAIProvider::new(k))
                } else {
                    eprintln!("❌ [background_task] OpenAI API key required");
                    return;
                }
            }
            "openrouter" => {
                if let Some(k) = api_key.clone() {
                    println!("✅ [background_task] Created OpenRouter provider");
                    Box::new(llm::openrouter::OpenRouterProvider::new(k))
                } else {
                    eprintln!("❌ [background_task] OpenRouter API key required");
                    return;
                }
            }
            "ollama" => {
                println!("✅ [background_task] Created Ollama provider with base_url: {:?}", base_url);
                Box::new(llm::ollama::OllamaProvider::new(base_url.clone()))
            },
            _ => {
                eprintln!("❌ [background_task] Unknown provider: {}", provider);
                return;
            }
        };

        // Send chat request with streaming
        println!("📤 [background_task] Sending chat request to LLM (model: {})", model);
        let request = ChatRequest {
            model: model.clone(),
            messages: chat_messages.clone(),
            stream: true,
        };
        println!("📤 [background_task] Request has {} messages", chat_messages.len());

        let conversation_id_for_stream = conversation_id_clone.clone();
        let app_for_stream = app.clone();
        let response = match llm_provider
            .chat_stream(
                request,
                Box::new(move |chunk: String| {
                    let payload = serde_json::json!({
                        "conversation_id": conversation_id_for_stream,
                        "content": chunk,
                    });
                    let _ = app_for_stream.emit("chat-stream", payload);
                }),
            )
            .await
        {
            Ok(r) => r,
            Err(e) => {
                eprintln!("LLM request failed: {}", e);
                return;
            }
        };

        // Save assistant message
        let assistant_message = match state_clone.db.create_message(CreateMessageRequest {
            conversation_id: Some(conversation_id_clone.clone()),
            sender_type: "assistant".to_string(),
            sender_id: None,
            role: "assistant".to_string(),
            content: response.content,
            thinking_content: response.thinking_content,
            tokens: response.tokens,
        }) {
            Ok(msg) => msg,
            Err(e) => {
                eprintln!("Failed to save assistant message: {}", e);
                return;
            }
        };
        
        // Notify frontend that streaming is complete with the saved message
        let completion_payload = serde_json::json!({
            "conversation_id": conversation_id_clone,
            "message": assistant_message,
        });
        let _ = app.emit("chat-complete", completion_payload);
        
        // Check if this is the first assistant reply and generate title if needed
        let should_generate_title = match state_clone.db.get_conversation(&conversation_id_clone) {
            Ok(Some(conv)) => conv.title == "New Conversation",
            _ => false,
        };
        
        if should_generate_title {
            println!("🏷️ [background_task] Generating conversation title...");
            let title_result = generate_conversation_title(
                &state_clone,
                &conversation_id_clone,
                &processed_content,
                &assistant_message.content,
                &provider,
                &model,
                api_key.clone(),
                base_url.clone(),
            ).await;
            
            match title_result {
                Ok(title) => {
                    println!("✅ [background_task] Generated title: {}", title);
                    match state_clone.db.update_conversation(&conversation_id_clone, &title) {
                        Ok(_) => {
                            // Emit event to notify frontend about the title update
                            let _ = app.emit("conversation-updated", serde_json::json!({
                                "conversation_id": conversation_id_clone,
                                "title": title,
                            }));
                        },
                        Err(e) => {
                            eprintln!("❌ [background_task] Failed to update conversation title: {}", e);
                        }
                    }
                },
                Err(e) => {
                    eprintln!("❌ [background_task] Failed to generate title: {}", e);
                }
            }
        }
    });

    // Return user message immediately
    Ok(user_message)
}

