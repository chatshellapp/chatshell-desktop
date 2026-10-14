use super::AppState;
use crate::models::{CreateMessageRequest, Message};
use tauri::State;

#[tauri::command]
pub async fn create_message(
    state: State<'_, AppState>,
    req: CreateMessageRequest,
) -> Result<Message, String> {
    state
        .db
        .create_message(req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_messages_by_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
    limit: Option<i64>,
    before_created_at: Option<String>,
    before_id: Option<String>,
) -> Result<Vec<Message>, String> {
    let before = match (before_created_at, before_id) {
        (Some(created_at), Some(id)) => Some((created_at, id)),
        (None, None) => None,
        _ => return Err("before_created_at and before_id must be passed together".into()),
    };
    let before = before.as_ref().map(|(ca, id)| (ca.as_str(), id.as_str()));
    state
        .db
        .list_messages_by_conversation(&conversation_id, limit, before)
        .await
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
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_messages_from(
    state: State<'_, AppState>,
    conversation_id: String,
    message_id: String,
) -> Result<(), String> {
    state
        .db
        .delete_messages_from(&conversation_id, &message_id)
        .await
        .map_err(|e| e.to_string())
}
