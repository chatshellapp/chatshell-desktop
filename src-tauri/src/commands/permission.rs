//! Permission gate commands: the frontend's answer to an approval request.

use super::AppState;
use crate::llm::permission::{ApprovalAnswer, ApprovalDecision, persistent_grants};
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePermissionRequest {
    pub request_id: String,
    /// `allow-once` | `allow-session` | `deny`
    pub decision: String,
    /// "Remember on this device": persist the call's remember scope when
    /// the decision allows it. Ignored for denials and forced prompts.
    #[serde(default)]
    pub remember: bool,
}

/// Deliver the user's approval decision. Returns false when the request
/// is unknown or already closed (timeout, stream end) — the frontend can
/// ignore that (its dialog is already gone).
#[tauri::command]
pub async fn resolve_permission(
    state: State<'_, AppState>,
    request: ResolvePermissionRequest,
) -> Result<bool, String> {
    let Some(decision) = ApprovalDecision::parse(&request.decision) else {
        return Err(format!("Unknown permission decision: {}", request.decision));
    };
    Ok(state.approval_registry.answer(
        &request.request_id,
        ApprovalAnswer {
            decision,
            remember: request.remember,
        },
    ))
}

/// Number of approvals remembered on this device.
#[tauri::command]
pub async fn count_permission_grants() -> Result<usize, String> {
    let Some(store) = persistent_grants() else {
        return Ok(0);
    };
    let store = store.clone();
    tokio::task::spawn_blocking(move || store.count())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

/// Forget every approval remembered on this device. Returns how many
/// were removed.
#[tauri::command]
pub async fn clear_permission_grants() -> Result<usize, String> {
    let Some(store) = persistent_grants() else {
        return Ok(0);
    };
    let store = store.clone();
    tokio::task::spawn_blocking(move || store.clear())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}
