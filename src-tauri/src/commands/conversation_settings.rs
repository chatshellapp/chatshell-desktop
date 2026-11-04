use super::AppState;
use crate::models::{ConversationSettings, UpdateConversationSettingsRequest};
use tauri::State;
use tracing::info;

#[tauri::command]
pub async fn get_conversation_settings(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<ConversationSettings, String> {
    info!(
        "[conversation_settings] get_conversation_settings called: {}",
        conversation_id
    );
    let result = state
        .db
        .get_conversation_settings(&conversation_id)
        .await
        .map_err(|e| e.to_string());
    info!(
        "[conversation_settings] get_conversation_settings result: {:?}",
        result
    );
    result
}

#[tauri::command]
pub async fn update_conversation_settings(
    state: State<'_, AppState>,
    conversation_id: String,
    req: UpdateConversationSettingsRequest,
) -> Result<ConversationSettings, String> {
    info!(
        "[conversation_settings] update_conversation_settings called: {}, req: {:?}",
        conversation_id, req
    );
    // A permission-mode switch invalidates this conversation's session
    // grants: approvals given under the old mode must not silently
    // authorize calls made under the new one. Grants live in RAM only.
    let mode_changed = match req.permission_mode {
        Some(new_mode) => {
            let existing = state
                .db
                .get_conversation_settings(&conversation_id)
                .await
                .map_err(|e| e.to_string())?;
            existing.permission_mode != new_mode
        }
        None => false,
    };
    let result = state
        .db
        .update_conversation_settings(&conversation_id, req)
        .await
        .map_err(|e| e.to_string());
    info!(
        "[conversation_settings] update_conversation_settings result: {:?}",
        result
    );
    if mode_changed && result.is_ok() {
        state
            .permission_grants
            .lock()
            .unwrap()
            .remove(&conversation_id);
        // A sandbox network escalation is a grant too.
        state.bash_session_manager.reset_network(&conversation_id);
    }
    result
}

#[tauri::command]
pub async fn reset_conversation_tools_to_global(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<ConversationSettings, String> {
    info!(
        "[conversation_settings] reset_conversation_tools_to_global called: {}",
        conversation_id
    );
    state
        .db
        .reset_tools_and_skills_to_global(&conversation_id)
        .await
        .map_err(|e| e.to_string())
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
