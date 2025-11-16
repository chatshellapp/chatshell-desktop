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

// Agent commands
#[tauri::command]
pub async fn create_agent(
    state: State<'_, AppState>,
    req: CreateAgentRequest,
) -> Result<Agent, String> {
    state.db.create_agent(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_agent(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Agent>, String> {
    state.db.get_agent(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_agents(
    state: State<'_, AppState>,
) -> Result<Vec<Agent>, String> {
    state.db.list_agents().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_agent(
    state: State<'_, AppState>,
    id: String,
    req: CreateAgentRequest,
) -> Result<Agent, String> {
    state.db.update_agent(&id, req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_agent(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.db.delete_agent(&id).map_err(|e| e.to_string())
}

// Topic commands
#[tauri::command]
pub async fn create_topic(
    state: State<'_, AppState>,
    req: CreateTopicRequest,
) -> Result<Topic, String> {
    state.db.create_topic(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_topic(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Topic>, String> {
    state.db.get_topic(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_topics(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<Vec<Topic>, String> {
    state.db.list_topics(&agent_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_topic(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<Topic, String> {
    state.db.update_topic(&id, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_topic(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.db.delete_topic(&id).map_err(|e| e.to_string())
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
pub async fn list_messages(
    state: State<'_, AppState>,
    topic_id: String,
) -> Result<Vec<Message>, String> {
    state.db.list_messages(&topic_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_messages(
    state: State<'_, AppState>,
    topic_id: String,
) -> Result<(), String> {
    state.db.delete_messages_in_topic(&topic_id).map_err(|e| e.to_string())
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

// Chat command - now returns immediately and processes in background
#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    topic_id: String,
    content: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    include_history: Option<bool>,
) -> Result<Message, String> {
    println!("🚀 [send_message] Command received!");
    println!("   topic_id: {}", topic_id);
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
            topic_id: topic_id.clone(),
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
    let user_message_id = user_message.id.clone(); // Clone to use inside spawn
    let app_clone = app.clone();
    tokio::spawn(async move {
        println!("🎯 [background_task] Started processing LLM request");
        // Check if message contains URLs and emit scraping started event
        let urls = scraper::extract_urls(&content);
        println!("🔍 [background_task] Found {} URLs", urls.len());
        if !urls.is_empty() {
            let _ = app_clone.emit("scraping-started", serde_json::json!({
                "message_id": user_message_id,
                "topic_id": topic_id,
            }));
        }
        
        // Process URLs in background (not blocking the command return)
        let processed_content = match scraper::process_message_with_urls(&content).await {
            Ok((full_content, scraped_only)) => {
                // Emit scraping complete event and update database
                if !urls.is_empty() {
                    // Update database with scraped content only (not including original message)
                    if let Err(e) = state_clone.db.update_message_scraping(&user_message_id, Some(scraped_only.clone()), None) {
                        eprintln!("Failed to update message with scraped content: {}", e);
                    }
                    
                    let _ = app_clone.emit("scraping-complete", serde_json::json!({
                        "message_id": user_message_id,
                        "topic_id": topic_id,
                        "scraped_content": scraped_only,
                    }));
                }
                full_content
            },
            Err(e) => {
                eprintln!("Failed to process URLs: {}, using original", e);
                // Emit scraping error event and update database
                if !urls.is_empty() {
                    // Update database with scraping error
                    if let Err(db_err) = state_clone.db.update_message_scraping(&user_message_id, None, Some(e.to_string())) {
                        eprintln!("Failed to update message with scraping error: {}", db_err);
                    }
                    
                    let _ = app_clone.emit("scraping-error", serde_json::json!({
                        "message_id": user_message_id,
                        "topic_id": topic_id,
                        "error": e.to_string(),
                    }));
                }
                content.clone()
            }
        };
        
        // Get topic and agent
        println!("📦 [background_task] Getting topic from database...");
        let topic = match state_clone.db.get_topic(&topic_id) {
            Ok(Some(t)) => {
                println!("✅ [background_task] Got topic: {}", t.title);
                t
            },
            Ok(None) => {
                eprintln!("❌ [background_task] Topic not found: {}", topic_id);
                return;
            },
            Err(e) => {
                eprintln!("❌ [background_task] Failed to get topic: {}", e);
                return;
            }
        };

        println!("📦 [background_task] Getting agent from database...");
        let agent = match state_clone.db.get_agent(&topic.agent_id) {
            Ok(Some(a)) => {
                println!("✅ [background_task] Got agent: {} (model_id: {})", a.name, a.model_id);
                a
            },
            Ok(None) => {
                eprintln!("❌ [background_task] Agent not found: {}", topic.agent_id);
                return;
            },
            Err(e) => {
                eprintln!("❌ [background_task] Failed to get agent: {}", e);
                return;
            }
        };

        println!("📦 [background_task] Getting model from database...");
        let model_info = match state_clone.db.get_model(&agent.model_id) {
            Ok(Some(m)) => {
                println!("✅ [background_task] Got model: {} ({})", m.name, m.model_id);
                m
            },
            Ok(None) => {
                eprintln!("❌ [background_task] Model not found: {}", agent.model_id);
                return;
            },
            Err(e) => {
                eprintln!("❌ [background_task] Failed to get model: {}", e);
                return;
            }
        };

        println!("📦 [background_task] Getting provider from database...");
        let provider_info = match state_clone.db.get_provider(&model_info.provider_id) {
            Ok(Some(p)) => {
                println!("✅ [background_task] Got provider: {} ({})", p.name, p.provider_type);
                p
            },
            Ok(None) => {
                eprintln!("❌ [background_task] Provider not found: {}", model_info.provider_id);
                return;
            },
            Err(e) => {
                eprintln!("❌ [background_task] Failed to get provider: {}", e);
                return;
            }
        };

        // Build chat messages
        let mut chat_messages = vec![ChatMessage {
            role: "system".to_string(),
            content: agent.system_prompt.clone(),
        }];

        // Include message history if requested (default: true)
        let should_include_history = include_history.unwrap_or(true);
        if should_include_history {
            if let Ok(messages) = state_clone.db.list_messages(&topic_id) {
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

        // Create LLM provider using provider info from database
        println!("🤖 [background_task] Creating LLM provider: {}", provider_info.provider_type);
        let llm_provider: Box<dyn LLMProvider> = match provider_info.provider_type.as_str() {
            "openai" => {
                let key = api_key.or(provider_info.api_key);
                if let Some(k) = key {
                    println!("✅ [background_task] Created OpenAI provider");
                    Box::new(llm::openai::OpenAIProvider::new(k))
                } else {
                    eprintln!("❌ [background_task] OpenAI API key required");
                    return;
                }
            }
            "openrouter" => {
                let key = api_key.or(provider_info.api_key);
                if let Some(k) = key {
                    println!("✅ [background_task] Created OpenRouter provider");
                    Box::new(llm::openrouter::OpenRouterProvider::new(k))
                } else {
                    eprintln!("❌ [background_task] OpenRouter API key required");
                    return;
                }
            }
            "ollama" => {
                let url = base_url.or(provider_info.base_url);
                println!("✅ [background_task] Created Ollama provider with base_url: {:?}", url);
                Box::new(llm::ollama::OllamaProvider::new(url))
            },
            _ => {
                eprintln!("❌ [background_task] Unknown provider: {}", provider_info.provider_type);
                return;
            }
        };

        // Send chat request with streaming using model info from database
        println!("📤 [background_task] Sending chat request to LLM (model: {})", model_info.model_id);
        let request = ChatRequest {
            model: model_info.model_id.clone(),
            messages: chat_messages.clone(),
            stream: true,
        };
        println!("📤 [background_task] Request has {} messages", chat_messages.len());

        let topic_id_for_stream = topic_id.clone();
        let app_for_stream = app.clone();
        let response = match llm_provider
            .chat_stream(
                request,
                Box::new(move |chunk: String| {
                    let payload = serde_json::json!({
                        "topic_id": topic_id_for_stream,
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
            topic_id: topic_id.clone(),
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
            "topic_id": topic_id,
            "message": assistant_message,
        });
        let _ = app.emit("chat-complete", completion_payload);
    });

    // Return user message immediately
    Ok(user_message)
}

