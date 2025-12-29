//! Agent-based streaming for LLM responses

use super::super::AppState;
use crate::llm::agent_builder::{
    AgentConfig, build_assistant_message, build_user_message, create_provider_agent,
    stream_chat_with_agent,
};
use crate::llm::{ChatMessage, StreamChunkType};
use crate::models::{
    CreateContentBlockRequest, CreateMessageRequest, CreateThinkingStepRequest,
    CreateToolCallRequest, ModelParameters,
};
use rig::completion::Message as RigMessage;
use rmcp::RoleClient;
use rmcp::model::Tool as McpTool;
use rmcp::service::Peer;
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
    tracing::info!(
        "✅ [agent_streaming] Using {} provider with agent API",
        provider_type
    );

    // Build agent config from system prompt and model parameters
    let mut config = AgentConfig::new().with_model_params(model_params);
    if let Some(prompt) = system_prompt.clone() {
        config = config.with_system_prompt(prompt);
    }

    // Load MCP tools for this conversation
    let mcp_tools_config =
        load_mcp_tools_for_conversation(&state_clone, &conversation_id_clone).await;

    if let Some((tools, client)) = mcp_tools_config {
        if !tools.is_empty() {
            tracing::info!(
                "🔌 [agent_streaming] Loaded {} MCP tools for conversation",
                tools.len()
            );
            config = config.with_mcp_tools(tools, client);
        }
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
                        if let Ok(mut current_block) = current_content_for_callback.try_write() {
                            if !current_block.trim().is_empty() {
                                let order = display_order_for_callback
                                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                                if let Ok(mut blocks) = content_blocks_for_callback.try_write() {
                                    blocks.push((order, current_block.clone()));
                                }
                                current_block.clear();
                            }
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
                    if let Ok(mut current_reasoning) = current_reasoning_for_callback.try_write() {
                        if !current_reasoning.trim().is_empty() {
                            let order = current_reasoning_order_for_callback
                                .load(std::sync::atomic::Ordering::SeqCst);
                            if order >= 0 {
                                if let Ok(mut blocks) = reasoning_blocks_for_callback.try_write() {
                                    blocks.push((order, current_reasoning.clone()));
                                }
                            }
                            current_reasoning.clear();
                        }
                    }
                    // Reset reasoning started for next round
                    reasoning_started_for_callback
                        .store(false, std::sync::atomic::Ordering::SeqCst);

                    // Flush any pending content block before tool call
                    if let Ok(mut current_block) = current_content_for_callback.try_write() {
                        if !current_block.trim().is_empty() {
                            let order = display_order_for_callback
                                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            if let Ok(mut blocks) = content_blocks_for_callback.try_write() {
                                blocks.push((order, current_block.clone()));
                            }
                            current_block.clear();
                        }
                    }

                    // Get display order for this tool call
                    let tool_order = display_order_for_callback
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

                    // Store tool call in tracking map with display order
                    if let Ok(mut tool_calls) = tool_calls_for_callback.try_write() {
                        tool_calls.insert(
                            tool_info.id.clone(),
                            (
                                tool_order,
                                tool_info.tool_name.clone(),
                                tool_info.tool_input.clone(),
                                None,
                            ),
                        );
                    }

                    // Emit tool call event to frontend
                    let payload = serde_json::json!({
                        "conversation_id": conversation_id_for_stream,
                        "tool_call_id": tool_info.id,
                        "tool_name": tool_info.tool_name,
                        "tool_input": tool_info.tool_input,
                    });
                    let _ = app_for_stream.emit("tool-call-started", payload);
                }
                StreamChunkType::ToolResult(result_info) => {
                    // Update tool call with result
                    if let Ok(mut tool_calls) = tool_calls_for_callback.try_write() {
                        if let Some((_, name, input, output)) = tool_calls.get_mut(&result_info.id)
                        {
                            *output = Some(result_info.tool_output.clone());

                            // Emit tool result event to frontend
                            let payload = serde_json::json!({
                                "conversation_id": conversation_id_for_stream,
                                "tool_call_id": result_info.id,
                                "tool_name": name.clone(),
                                "tool_input": input.clone(),
                                "tool_output": result_info.tool_output,
                            });
                            let _ = app_for_stream.emit("tool-call-completed", payload);
                        }
                    }
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
                tracing::info!("🛑 [agent_streaming] Generation was cancelled");

                // Get accumulated content
                let accumulated = accumulated_content.read().await.clone();
                let accumulated_reasoning_content = accumulated_reasoning.read().await.clone();

                if !accumulated.trim().is_empty() {
                    tracing::info!(
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
                            tracing::info!(
                                "✅ [agent_streaming] Partial message saved: {}",
                                msg.id
                            );

                            // Save thinking content if any
                            if !accumulated_reasoning_content.is_empty() {
                                let _ = state_clone
                                    .db
                                    .create_thinking_step(CreateThinkingStepRequest {
                                        message_id: msg.id.clone(),
                                        content: accumulated_reasoning_content,
                                        source: Some("llm".to_string()),
                                        display_order: Some(0),
                                    })
                                    .await;
                            }

                            let completion_payload = serde_json::json!({
                                "conversation_id": conversation_id_clone,
                                "message": msg,
                                "cancelled": true,
                            });
                            let _ = app.emit("chat-complete", completion_payload);
                        }
                        Err(e) => {
                            tracing::error!("Failed to save partial message: {}", e);
                            let error_payload = serde_json::json!({
                                "conversation_id": conversation_id_clone,
                                "error": format!("Failed to save partial message: {}", e),
                            });
                            let _ = app.emit("chat-error", error_payload);
                        }
                    }
                }
            } else {
                tracing::error!("❌ [agent_streaming] Stream error: {}", e);

                // Emit error event to frontend so it can reset UI state
                let error_payload = serde_json::json!({
                    "conversation_id": conversation_id_clone,
                    "error": e.to_string(),
                });
                let _ = app.emit("chat-error", error_payload);
            }

            let mut tasks = state_clone.generation_tasks.write().await;
            tasks.remove(&conversation_id_clone);
            return;
        }
    };

    // Get the final content
    let final_content = response.content.clone();
    tracing::info!(
        "✅ [agent_streaming] Response complete: {} chars",
        final_content.len()
    );

    // Don't save empty responses - they cause API errors on subsequent requests
    // ("all messages must have non-empty content")
    if final_content.trim().is_empty() {
        tracing::info!("⚠️ [agent_streaming] Skipping save of empty response");
        let error_payload = serde_json::json!({
            "conversation_id": conversation_id_clone,
            "error": "Model returned empty response",
        });
        let _ = app.emit("chat-error", error_payload);
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

    // Fallback: if no ordered reasoning blocks but we have thinking content, save it
    if reasoning_blocks.read().await.is_empty() {
        if let Some(thinking_content) = response.thinking_content
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
    }

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
            } else {
                "pending"
            };

            match state_clone
                .db
                .create_tool_call(CreateToolCallRequest {
                    message_id: assistant_message.id.clone(),
                    tool_name: tool_name.clone(),
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
    // Only save if we have tool calls (otherwise content is just the message content)
    let content_data = content_blocks.read().await;
    let has_tool_calls = !tool_calls_map.read().await.is_empty();
    if has_tool_calls && !content_data.is_empty() {
        tracing::info!(
            "💾 [agent_streaming] Saving {} content block(s) to database",
            content_data.len()
        );

        for (order, content) in content_data.iter() {
            if content.trim().is_empty() {
                continue;
            }
            match state_clone
                .db
                .create_content_block(CreateContentBlockRequest {
                    message_id: assistant_message.id.clone(),
                    content: content.clone(),
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
                    tracing::error!(
                        "❌ [agent_streaming] Failed to save content block: {}",
                        e
                    );
                }
            }
        }
    }
    drop(content_data);

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

/// Load MCP tools for a conversation
/// Returns (tools, client) if MCP servers are configured, None otherwise
async fn load_mcp_tools_for_conversation(
    state: &AppState,
    conversation_id: &str,
) -> Option<(Vec<McpTool>, Peer<RoleClient>)> {
    // Get conversation settings to find enabled MCP servers
    let settings = match state.db.get_conversation_settings(conversation_id).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("⚠️ [mcp] Failed to get conversation settings: {}", e);
            return None;
        }
    };

    if settings.enabled_mcp_server_ids.is_empty() {
        return None;
    }

    tracing::info!(
        "🔌 [mcp] Loading {} MCP server(s) for conversation",
        settings.enabled_mcp_server_ids.len()
    );

    // Get the tool configurations from DB
    let tools = match state
        .db
        .get_tools_by_ids(&settings.enabled_mcp_server_ids)
        .await
    {
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

    // Connect to all enabled MCP servers and collect tools
    let connections = match state.mcp_manager.connect_multiple(&enabled_tools).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("⚠️ [mcp] Failed to connect to MCP servers: {}", e);
            return None;
        }
    };

    if connections.is_empty() {
        return None;
    }

    // Collect all tools from all servers
    // Note: For simplicity, we use the first server's client for all tools
    // In a more complex setup, we'd need to track which client handles which tools
    let mut all_tools = Vec::new();
    let mut first_client: Option<Peer<RoleClient>> = None;

    for (conn, tools) in connections {
        if first_client.is_none() {
            first_client = Some(conn.client.clone());
        }
        all_tools.extend(tools);
    }

    first_client.map(|client| (all_tools, client))
}
