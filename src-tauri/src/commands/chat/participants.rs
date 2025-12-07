//! Participant management for conversations
//!
//! Handles auto-adding participants (users, models, assistants) to conversations.

use super::AppState;
use crate::models::CreateConversationParticipantRequest;

/// Ensure required participants are added to a conversation
pub async fn ensure_participants(
    state: &AppState,
    conversation_id: &str,
    model_db_id: &Option<String>,
    assistant_db_id: &Option<String>,
) {
    let existing_participants = match state
        .db
        .list_conversation_participants(conversation_id)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to list participants: {}", e);
            return;
        }
    };

    let has_user = existing_participants
        .iter()
        .any(|p| p.participant_type == "user");

    let current_model_exists = model_db_id.as_ref().map_or(false, |model_id| {
        existing_participants
            .iter()
            .any(|p| p.participant_type == "model" && p.participant_id.as_ref() == Some(model_id))
    });

    let current_assistant_exists = assistant_db_id.as_ref().map_or(false, |assistant_id| {
        existing_participants.iter().any(|p| {
            p.participant_type == "assistant" && p.participant_id.as_ref() == Some(assistant_id)
        })
    });

    println!(
        "📋 [send_message] Current participants: {} total",
        existing_participants.len()
    );

    // Add self user if not present
    if !has_user {
        add_self_user_participant(state, conversation_id).await;
    }

    // Add assistant or model participant
    if let Some(assistant_id) = assistant_db_id {
        if !current_assistant_exists {
            add_assistant_participant(state, conversation_id, assistant_id).await;
        }
    } else if let Some(model_id) = model_db_id {
        if !current_model_exists {
            add_model_participant(state, conversation_id, model_id).await;
        }
    }
}

async fn add_self_user_participant(state: &AppState, conversation_id: &str) {
    println!("👤 [send_message] Adding self user as participant...");
    match state.db.get_self_user().await {
        Ok(Some(self_user)) => {
            match state
                .db
                .add_conversation_participant(CreateConversationParticipantRequest {
                    conversation_id: conversation_id.to_string(),
                    participant_type: "user".to_string(),
                    participant_id: Some(self_user.id.clone()),
                    display_name: Some(self_user.display_name.clone()),
                })
                .await
            {
                Ok(_) => println!("✅ [send_message] Added self user as participant"),
                Err(e) => println!("⚠️  [send_message] Failed to add self user: {}", e),
            }
        }
        Ok(None) => println!("⚠️  [send_message] No self user found"),
        Err(e) => println!("⚠️  [send_message] Error getting self user: {}", e),
    }
}

async fn add_assistant_participant(state: &AppState, conversation_id: &str, assistant_id: &str) {
    println!(
        "🤖 [send_message] Adding assistant as participant (assistant_id: {})...",
        assistant_id
    );
    match state.db.get_assistant(assistant_id).await {
        Ok(Some(assistant)) => {
            match state
                .db
                .add_conversation_participant(CreateConversationParticipantRequest {
                    conversation_id: conversation_id.to_string(),
                    participant_type: "assistant".to_string(),
                    participant_id: Some(assistant.id.clone()),
                    display_name: Some(assistant.name.clone()),
                })
                .await
            {
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
}

async fn add_model_participant(state: &AppState, conversation_id: &str, model_id: &str) {
    println!(
        "🤖 [send_message] Adding model as participant (model_id: {})...",
        model_id
    );
    match state.db.get_model(model_id).await {
        Ok(Some(model)) => {
            match state
                .db
                .add_conversation_participant(CreateConversationParticipantRequest {
                    conversation_id: conversation_id.to_string(),
                    participant_type: "model".to_string(),
                    participant_id: Some(model.id.clone()),
                    display_name: Some(model.name.clone()),
                })
                .await
            {
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
}

