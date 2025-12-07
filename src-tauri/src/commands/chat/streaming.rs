//! Agent-based streaming for LLM responses

use super::super::AppState;
use crate::llm::agent_builder::{
    build_assistant_message, build_user_message, create_provider_agent, stream_chat_with_agent,
    AgentConfig,
};
use crate::llm::{ChatMessage, StreamChunkType};
use crate::models::{CreateMessageRequest, CreateThinkingStepRequest, ModelParameters, StepType};
use rig::completion::Message as RigMessage;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use super::title::auto_generate_title_if_needed;

/// Handle streaming using the agent-based approach
/// This provides built-in support for preamble, temperature, max_tokens, etc.
pub(crate) async fn handle_agent_streaming(
    provider_type: String,
    model_id: String,
    chat_messages: Vec<ChatMessage>,
    api_key: Option<String>,
    base_url: Option<String>,
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
    println!(
        "✅ [agent_streaming] Using {} provider with agent API",
        provider_type
    );

    // Build agent config from system prompt and model parameters
    let mut config = AgentConfig::new().with_model_params(model_params);
    if let Some(prompt) = system_prompt.clone() {
        config = config.with_system_prompt(prompt);
    }

    // Create the agent
    let agent = match create_provider_agent(
        &provider_type,
        &model_id,
        api_key.as_deref(),
        base_url.as_deref(),
        &config,
    ) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("❌ [agent_streaming] Failed to create agent: {}", e);
            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            return;
        }
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
    let reasoning_started = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let accumulated_content_for_callback = accumulated_content.clone();
    let accumulated_reasoning_for_callback = accumulated_reasoning.clone();
    let reasoning_started_for_callback = reasoning_started.clone();
    let conversation_id_for_stream = conversation_id_clone.clone();
    let app_for_stream = app.clone();
    let cancel_token_for_callback = cancel_token.clone();

    // Stream using the agent
    let response = stream_chat_with_agent(
        agent,
        prompt,
        chat_history,
        cancel_token.clone(),
        move |chunk: String, chunk_type: StreamChunkType| -> bool {
            // Check if cancelled
            if cancel_token_for_callback.is_cancelled() {
                println!("🛑 [agent_streaming] Generation cancelled, stopping stream");
                return false;
            }

            match chunk_type {
                StreamChunkType::Text => {
                    // Accumulate text content
                    if let Ok(mut content) = accumulated_content_for_callback.try_write() {
                        content.push_str(&chunk);
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
                        let started_payload = serde_json::json!({
                            "conversation_id": conversation_id_for_stream,
                        });
                        let _ = app_for_stream.emit("reasoning-started", started_payload);
                    }

                    // Accumulate reasoning content
                    if let Ok(mut reasoning) = accumulated_reasoning_for_callback.try_write() {
                        reasoning.push_str(&chunk);
                    }

                    let payload = serde_json::json!({
                        "conversation_id": conversation_id_for_stream,
                        "content": chunk,
                    });
                    let _ = app_for_stream.emit("chat-stream-reasoning", payload);
                }
            }

            true // Continue streaming
        },
        &provider_type,
    )
    .await;

    // Handle the response
    let response = match response {
        Ok(r) => r,
        Err(e) => {
            // Check if this was a cancellation
            if cancel_token.is_cancelled() {
                println!("🛑 [agent_streaming] Generation was cancelled");

                // Get accumulated content
                let accumulated = accumulated_content.read().await.clone();
                let accumulated_reasoning_content = accumulated_reasoning.read().await.clone();

                if !accumulated.trim().is_empty() {
                    println!(
                        "📝 [agent_streaming] Saving partial response ({} chars)",
                        accumulated.len()
                    );

                    // Determine sender type and ID
                    let (sender_type, sender_id) = if let Some(model_id) = model_db_id.clone() {
                        ("model".to_string(), Some(model_id))
                    } else if let Some(assistant_id) = assistant_db_id.clone() {
                        ("assistant".to_string(), Some(assistant_id))
                    } else {
                        ("assistant".to_string(), None)
                    };

                    // Save partial response
                    match state_clone
                        .db
                        .create_message(CreateMessageRequest {
                            conversation_id: Some(conversation_id_clone.clone()),
                            sender_type: sender_type.clone(),
                            sender_id: sender_id.clone(),
                            content: accumulated.clone(),
                            tokens: None,
                        })
                        .await
                    {
                        Ok(msg) => {
                            println!("✅ [agent_streaming] Partial message saved: {}", msg.id);

                            // Save thinking content if any
                            if !accumulated_reasoning_content.is_empty() {
                                if let Ok(thinking_step) = state_clone
                                    .db
                                    .create_thinking_step(CreateThinkingStepRequest {
                                        content: accumulated_reasoning_content,
                                        source: Some("llm".to_string()),
                                    })
                                    .await
                                {
                                    let _ = state_clone
                                        .db
                                        .link_message_step(
                                            &msg.id,
                                            StepType::Thinking,
                                            &thinking_step.id,
                                            Some(0),
                                        )
                                        .await;
                                }
                            }

                            let completion_payload = serde_json::json!({
                                "conversation_id": conversation_id_clone,
                                "message": msg,
                                "cancelled": true,
                            });
                            let _ = app.emit("chat-complete", completion_payload);
                        }
                        Err(e) => {
                            eprintln!("Failed to save partial message: {}", e);
                        }
                    }
                }
            } else {
                eprintln!("❌ [agent_streaming] Stream error: {}", e);
            }

            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            return;
        }
    };

    // Get the final content
    let final_content = response.content.clone();
    println!(
        "✅ [agent_streaming] Response complete: {} chars",
        final_content.len()
    );

    // Don't save empty responses - they cause API errors on subsequent requests
    // ("all messages must have non-empty content")
    if final_content.trim().is_empty() {
        println!("⚠️ [agent_streaming] Skipping save of empty response");
        let mut tasks = state_clone.generation_tasks.write().await;
        tasks.remove(&conversation_id_clone);
        return;
    }

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
            content: final_content.clone(),
            tokens: response.tokens,
        })
        .await
    {
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
            match state_clone
                .db
                .create_thinking_step(CreateThinkingStepRequest {
                    content: thinking_content,
                    source: Some("llm".to_string()),
                })
                .await
            {
                Ok(thinking_step) => {
                    if let Err(e) = state_clone
                        .db
                        .link_message_step(
                            &assistant_message.id,
                            StepType::Thinking,
                            &thinking_step.id,
                            Some(0),
                        )
                        .await
                    {
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
        )
        .await;
    });
}

