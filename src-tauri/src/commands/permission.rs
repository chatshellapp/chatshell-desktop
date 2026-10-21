//! Permission gate commands: the frontend's answer to an approval request.

use super::AppState;
use crate::llm::permission::ApprovalDecision;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePermissionRequest {
    pub request_id: String,
    /// `allow-once` | `allow-session` | `deny`
    pub decision: String,
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
    Ok(state
        .approval_registry
        .resolve(&request.request_id, decision))
}
