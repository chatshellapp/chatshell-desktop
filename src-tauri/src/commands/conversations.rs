use super::AppState;
use crate::models::{
    Conversation, ConversationParticipant, CreateConversationParticipantRequest,
    CreateConversationRequest, ParticipantSummary,
};
use tauri::State;

#[tauri::command]
pub async fn create_conversation(
    state: State<'_, AppState>,
    req: CreateConversationRequest,
) -> Result<Conversation, String> {
    state
        .db
        .create_conversation(req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_conversation(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<Conversation>, String> {
    state
        .db
        .get_conversation(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    state
        .db
        .list_conversations()
        .await
        .map_err(|e| e.to_string())
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
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_conversation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .db
        .delete_conversation(&id)
        .await
        .map_err(|e| e.to_string())
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
        .await
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
        .await
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
        .await
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
        .await
        .map_err(|e| e.to_string())
}
