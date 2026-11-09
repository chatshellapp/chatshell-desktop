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
        // Platform list: Windows adds its process-startup variables.
        allowlist: shell_env::allowlist()
            .into_iter()
            .map(str::to_string)
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

/// Whether this machine can run bash inside the OS sandbox (`auto` mode
/// is offered only when it can).
#[derive(Debug, serde::Serialize)]
pub struct SandboxStatus {
    pub available: bool,
    /// `seatbelt` or `bubblewrap`, when available.
    pub backend: Option<&'static str>,
}

#[tauri::command]
pub async fn get_sandbox_status() -> Result<SandboxStatus, String> {
    use chatshell_agent_core::sandbox::{SandboxBackend, detect_backend};
    let backend = detect_backend().map(|backend| match backend {
        SandboxBackend::Seatbelt => "seatbelt",
        SandboxBackend::Bubblewrap(_) => "bubblewrap",
    });
    Ok(SandboxStatus {
        available: backend.is_some(),
        backend,
    })
}

// ---------------------------------------------------------------------------
// Auto mode (permission v3)
// ---------------------------------------------------------------------------

/// How `auto` resolves for a model, for the mode ladder and Settings.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoReviewStatus {
    /// `judged` (classifier, zero prompts) or `ask` (no eligible judge:
    /// the conversation runs in `ask`, jailed wherever a backend exists).
    pub resolution: &'static str,
    /// Why the classifier is not used, when it is not.
    pub reason: Option<String>,
    /// The model that judges (`provider/model`).
    pub judge: Option<String>,
}

/// The conversation model to resolve against: an explicit model row (the
/// composer's selection), else the conversation's participant model.
async fn status_conversation_model(
    state: &AppState,
    model_db_id: Option<&str>,
    conversation_id: Option<&str>,
) -> Result<crate::commands::chat::aux_models::ConversationModel, String> {
    if let Some(model_db_id) = model_db_id {
        let model = state
            .db
            .get_model(model_db_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Model not found".to_string())?;
        let provider = state
            .db
            .get_provider(&model.provider_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Provider not found".to_string())?;
        return Ok(crate::commands::chat::aux_models::ConversationModel {
            provider_type: provider.provider_type,
            model_id: model.model_id,
            api_key: provider.api_key,
            base_url: provider.base_url,
            api_style: provider.api_style,
            supports_vision: None,
        });
    }
    let conversation_id =
        conversation_id.ok_or_else(|| "A model or conversation is required".to_string())?;
    let (provider_type, model_id, api_key, base_url, api_style) =
        crate::commands::chat::title::get_conversation_provider_info(state, conversation_id)
            .await?;
    Ok(crate::commands::chat::aux_models::ConversationModel {
        provider_type,
        model_id,
        api_key,
        base_url,
        api_style,
        supports_vision: None,
    })
}

/// How `auto` resolves for a model (AR-9, AR-19). Probes the judge on
/// first use; `recheck` (a model or classifier-model change) drops the
/// cached result first. Never probed per tool call.
#[tauri::command]
pub async fn get_auto_review_status(
    state: State<'_, AppState>,
    model_db_id: Option<String>,
    conversation_id: Option<String>,
    recheck: Option<bool>,
) -> Result<AutoReviewStatus, String> {
    use chatshell_agent_core::judgment::engine::{
        AutoResolution, Eligibility, JudgeModel, resolve_auto,
    };
    let conversation =
        status_conversation_model(&state, model_db_id.as_deref(), conversation_id.as_deref())
            .await?;
    let judge = crate::llm::auto_review::resolve_classifier_model(&state, &conversation).await;
    if recheck == Some(true) {
        crate::llm::auto_review::eligibility_cache().invalidate(&judge.cache_key());
    }
    let eligibility = crate::llm::auto_review::eligibility_for(
        &judge,
        &tokio_util::sync::CancellationToken::new(),
    )
    .await;
    let resolution = resolve_auto(Some(&eligibility));
    Ok(AutoReviewStatus {
        resolution: match resolution {
            AutoResolution::Judged => "judged",
            AutoResolution::Ask => "ask",
        },
        reason: match eligibility {
            Eligibility::Eligible(_) => None,
            Eligibility::Ineligible { reason } => Some(reason),
        },
        judge: Some(judge.label()),
    })
}

/// What the frontend needs to ask the model to retry a run-anyway action.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAnywayTicket {
    pub tool_name: String,
    pub subject: String,
    /// The retry runs outside the sandbox (a `jail-denied` marker).
    pub unsandboxed: bool,
}

/// Run a denied action anyway (AR-17): arm a one-shot override for that
/// exact action — consumed by the model's retry in the next turn, never a
/// grant — and record the human override in the decision log. The
/// frontend then sends the retry request as a user message.
#[tauri::command]
pub async fn auto_review_run_anyway(
    state: State<'_, AppState>,
    conversation_id: String,
    decision_id: String,
) -> Result<RunAnywayTicket, String> {
    super::ensure_no_generation(&state, &conversation_id).await?;
    let action = crate::llm::auto_review::arm_override(&conversation_id, &decision_id)
        .ok_or_else(|| "This action can no longer be run from here".to_string())?;
    if let Some(log) = crate::llm::auto_review::decision_log().cloned() {
        let id = decision_id.clone();
        match tokio::task::spawn_blocking(move || log.mark_override(&id)).await {
            Ok(Ok(_)) => {}
            Ok(Err(err)) => tracing::warn!("🛡️ [auto_review] Override not logged: {err:#}"),
            Err(err) => tracing::warn!("🛡️ [auto_review] Override log task failed: {err}"),
        }
    }
    tracing::info!(
        "🛡️ [auto_review] Run-anyway armed for {} {}",
        action.tool_name,
        action.subject
    );
    Ok(RunAnywayTicket {
        tool_name: action.tool_name,
        subject: action.subject,
        unsandboxed: action.unsandboxed,
    })
}

/// A persisted transcript marker (AR-16).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoReviewMarker {
    pub decision_id: String,
    pub tool_call_id: Option<String>,
    /// `allowed`, `denied`, `failed`, or `jail_denied`.
    pub kind: &'static str,
    pub risk_level: Option<String>,
    pub rationale: Option<String>,
    /// The user ran it anyway.
    pub overridden: bool,
}

/// This device's markers for a conversation (the decision log is
/// device-local, so other devices show none).
#[tauri::command]
pub async fn list_auto_review_markers(
    conversation_id: String,
) -> Result<Vec<AutoReviewMarker>, String> {
    let Some(log) = crate::llm::auto_review::decision_log().cloned() else {
        return Ok(Vec::new());
    };
    let records = tokio::task::spawn_blocking(move || log.list_for_conversation(&conversation_id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
    Ok(records.into_iter().filter_map(marker_from_record).collect())
}

fn marker_from_record(
    record: chatshell_agent_core::judgment::log::DecisionRecord,
) -> Option<AutoReviewMarker> {
    let kind = match record.outcome.as_str() {
        "allow" => "allowed",
        "deny" => "denied",
        "failed" => "failed",
        "jail_denied" => "jail_denied",
        _ => return None,
    };
    Some(AutoReviewMarker {
        overridden: record.overridden_at.is_some(),
        decision_id: record.id,
        tool_call_id: record.tool_call_id,
        kind,
        risk_level: record.risk_level,
        rationale: match kind {
            // Failure rows hold the model-facing wording; markers show a
            // localized line instead.
            "failed" => None,
            _ => record.rationale,
        },
    })
}
