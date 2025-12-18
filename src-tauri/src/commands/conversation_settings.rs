use super::AppState;
use crate::models::{ConversationSettings, UpdateConversationSettingsRequest};
use tauri::State;
use tracing::info;

#[tauri::command]
pub async fn get_conversation_settings(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<ConversationSettings, String> {
    info!("[conversation_settings] get_conversation_settings called: {}", conversation_id);
    let result = state
        .db
        .get_conversation_settings(&conversation_id)
        .await
        .map_err(|e| e.to_string());
    info!("[conversation_settings] get_conversation_settings result: {:?}", result);
    result
}

#[tauri::command]
pub async fn update_conversation_settings(
    state: State<'_, AppState>,
    conversation_id: String,
    req: UpdateConversationSettingsRequest,
) -> Result<ConversationSettings, String> {
    info!("[conversation_settings] update_conversation_settings called: {}, req: {:?}", conversation_id, req);
    let result = state
        .db
        .update_conversation_settings(&conversation_id, req)
        .await
        .map_err(|e| e.to_string());
    info!("[conversation_settings] update_conversation_settings result: {:?}", result);
    result
}

#[tauri::command]
pub async fn delete_conversation_settings(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    state
        .db
        .delete_conversation_settings(&conversation_id)
        .await
        .map_err(|e| e.to_string())
}


