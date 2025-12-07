//! Conversation title generation

use super::super::AppState;
use crate::llm::{self, ChatMessage};
use crate::prompts;
use anyhow::Result;
use tauri::{Emitter, State};

/// Helper to get provider info from conversation participants
pub(crate) async fn get_conversation_provider_info(
    state: &AppState,
    conversation_id: &str,
) -> Result<(String, String, Option<String>, Option<String>), String> {
    let participants = state
        .db
        .list_conversation_participants(conversation_id)
        .await
        .map_err(|e| e.to_string())?;

    let model_participant = participants
        .iter()
        .find(|p| p.participant_type == "model" || p.participant_type == "assistant");

    if let Some(participant) = model_participant {
        if let Some(ref participant_id) = participant.participant_id {
            if participant.participant_type == "model" {
                let model_info = state
                    .db
                    .get_model(participant_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Model not found".to_string())?;

                let provider_info = state
                    .db
                    .get_provider(&model_info.provider_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Provider not found".to_string())?;

                return Ok((
                    provider_info.provider_type,
                    model_info.model_id,
                    provider_info.api_key,
                    provider_info.base_url,
                ));
            } else {
                let assistant = state
                    .db
                    .get_assistant(participant_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Assistant not found".to_string())?;

                let model_info = state
                    .db
                    .get_model(&assistant.model_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Assistant's model not found".to_string())?;

                let provider_info = state
                    .db
                    .get_provider(&model_info.provider_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Provider not found".to_string())?;

                return Ok((
                    provider_info.provider_type,
                    model_info.model_id,
                    provider_info.api_key,
                    provider_info.base_url,
                ));
            }
        }
        return Err("Participant has no ID".to_string());
    }
    Err("No model or assistant found in conversation".to_string())
}

#[tauri::command]
pub async fn generate_conversation_title_manually(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<String, String> {
    println!(
        "🏷️ [manual_title] Generating title for conversation: {}",
        conversation_id
    );

    // Get conversation messages
    let messages = state
        .db
        .list_messages_by_conversation(&conversation_id)
        .await
        .map_err(|e| e.to_string())?;

    if messages.is_empty() {
        return Err("No messages in conversation to generate title from".to_string());
    }

    // Find first user message and first assistant message
    let user_message = messages
        .iter()
        .find(|m| m.sender_type == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    let assistant_message = messages
        .iter()
        .find(|m| m.sender_type == "model" || m.sender_type == "assistant")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    if user_message.is_empty() {
        return Err("No user message found to generate title from".to_string());
    }

    // Get provider info from conversation participants
    let (provider, model, api_key, base_url) =
        get_conversation_provider_info(&state, &conversation_id).await?;

    // Generate the title
    let title = generate_conversation_title(
        &state,
        &conversation_id,
        &user_message,
        &assistant_message,
        &provider,
        &model,
        api_key,
        base_url,
    )
    .await
    .map_err(|e| e.to_string())?;

    println!("🏷️ [manual_title] Generated title: {}", title);
    Ok(title)
}

/// Helper function to generate conversation title
pub(crate) async fn generate_conversation_title(
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
        .await
        .ok()
        .flatten();

    let (summary_provider, summary_model, summary_api_key, summary_base_url) =
        if let Some(model_id) = summary_model_id {
            // Get the custom model settings
            match state.db.get_model(&model_id).await {
                Ok(Some(m)) => {
                    // Get provider info
                    match state.db.get_provider(&m.provider_id).await {
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
                content: prompts::build_title_generation_user_prompt(user_message, assistant_message),
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

/// Helper function to auto-generate title for new conversations
pub(crate) async fn auto_generate_title_if_needed(
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
    if let Ok(Some(conversation)) = state.db.get_conversation(conversation_id).await {
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
                    match state.db.update_conversation(conversation_id, &title).await {
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

