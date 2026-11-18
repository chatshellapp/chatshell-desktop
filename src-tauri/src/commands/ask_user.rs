//! Answers to the model's `ask_user` questions.

use std::sync::Arc;

use chatshell_agent_core::tools::AskUserAnswer;
use tauri::State;

use crate::llm::ask_user::{AskUserBroker, parse_response};

/// Answer an open `ask_user` request: `submit` or `discuss` with the
/// answers entered so far, or `decline`. False when the request is unknown
/// or already closed (the turn was stopped) — the dialog is gone then. The
/// core validates answers against the request before the model sees them.
#[tauri::command]
pub async fn resolve_ask_user(
    broker: State<'_, Arc<AskUserBroker>>,
    request_id: String,
    action: String,
    answers: Option<Vec<AskUserAnswer>>,
) -> Result<bool, String> {
    let outcome = parse_response(&action, answers.unwrap_or_default())
        .ok_or_else(|| format!("Unknown ask_user action: {action}"))?;
    Ok(broker.answer(&request_id, outcome))
}
