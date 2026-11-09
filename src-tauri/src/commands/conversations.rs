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
pub async fn delete_conversation(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    // Cancel any active generation for this conversation
    if let Some(cancel_token) = state.generation_tasks.write().await.remove(&id) {
        cancel_token.cancel();
    }

    // Kill the conversation's bash session before its scratch directory
    // is removed below: a running command is aborted and the shell killed,
    // so no process outlives (or races) the cleanup.
    state
        .bash_session_manager
        .shutdown(&id, std::time::Duration::from_secs(5))
        .await;

    state
        .db
        .delete_conversation(&id)
        .await
        .map_err(|e| e.to_string())?;

    // Drop the conversation's session grants so they do not linger in RAM
    // for the rest of the app's lifetime.
    crate::llm::permission::forget_conversation_grants(&state.permission_grants, &id);
    crate::llm::auto_review::forget_conversation(&id);
    if let Some(log) = crate::llm::auto_review::decision_log().cloned() {
        let conversation = id.clone();
        let _ = tokio::task::spawn_blocking(move || log.forget_conversation(&conversation)).await;
    }
    if let Some(root) = crate::tool_outputs::root(&app) {
        crate::tool_outputs::remove_conversation(&root, &id);
    }
    if let Some(history) = crate::storage::file_history_dir(&app, &id)
        && history.exists()
    {
        let _ = std::fs::remove_dir_all(&history);
    }
    // Bash scratch (TMPDIR, data-file copies) dies with the conversation.
    let scratch = crate::storage::conversation_scratch_dir(&app, &id);
    if scratch.exists()
        && let Err(e) = std::fs::remove_dir_all(&scratch)
    {
        tracing::warn!("🧹 Could not remove scratch {}: {e}", scratch.display());
    }
    Ok(())
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

#[tauri::command]
pub async fn fork_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
    message_id: String,
) -> Result<Conversation, String> {
    state
        .db
        .fork_conversation(&conversation_id, &message_id)
        .await
        .map_err(|e| e.to_string())
}
