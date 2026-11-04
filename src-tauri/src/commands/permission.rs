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

/// Bash environment settings for the Settings UI.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BashEnvironmentView {
    /// Variables every bash session receives.
    pub allowlist: Vec<String>,
    /// Extra variables the user passes through on this device.
    pub passthrough: Vec<String>,
    /// Suggested variables set in the app environment, not yet passed.
    pub suggestions: Vec<String>,
}

fn bash_environment_view(passthrough: Vec<String>) -> BashEnvironmentView {
    use chatshell_agent_core::shell_env;
    let suggestions = shell_env::suggestions(|name| std::env::var(name).ok())
        .into_iter()
        .filter(|name| !passthrough.contains(name))
        .collect();
    BashEnvironmentView {
        allowlist: shell_env::BASE_ALLOWLIST
            .iter()
            .map(|name| name.to_string())
            .collect(),
        passthrough,
        suggestions,
    }
}

/// Current bash environment settings of this device.
#[tauri::command]
pub async fn get_bash_environment() -> Result<BashEnvironmentView, String> {
    let passthrough = match crate::llm::permission::bash_env_store() {
        Some(store) => store.load().map_err(|e| format!("{e:#}"))?.passthrough,
        None => Vec::new(),
    };
    Ok(bash_environment_view(passthrough))
}

/// Replace this device's passthrough list. Takes effect on the next bash
/// command (the session restarts with the new environment).
#[tauri::command]
pub async fn set_bash_environment(passthrough: Vec<String>) -> Result<BashEnvironmentView, String> {
    let store = crate::llm::permission::bash_env_store()
        .ok_or_else(|| "Bash environment store is not initialized".to_string())?;
    let saved = store.save(&passthrough).map_err(|e| format!("{e:#}"))?;
    Ok(bash_environment_view(saved.passthrough))
}
