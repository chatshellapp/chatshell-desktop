//! Tauri commands for snapshot sync (Phase 3a).

use super::AppState;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SyncNowResult {
    pub enabled: bool,
    pub action: String,
    pub rows_merged: usize,
    pub republished: bool,
}

/// Run one full sync pass — the exact code path the background scheduler
/// uses (`sync::run_sync_pass`): blob upload first (blobs-before-snapshots,
/// ADR 02), pull/merge, incremental FTS reconcile, `sync-merged` event on
/// non-empty merges, opportunistic blob GC. Delegating keeps the manual
/// trigger from ever publishing a snapshot whose blobs have not shipped.
#[tauri::command]
pub async fn sync_now(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SyncNowResult, String> {
    let outcome = crate::sync::run_sync_pass(state.sync_engine.clone(), state.db.clone(), app)
        .await
        .map_err(|e| e.to_string())?;
    Ok(match outcome {
        None => SyncNowResult {
            enabled: false,
            action: "disabled".into(),
            rows_merged: 0,
            republished: false,
        },
        Some(outcome) => SyncNowResult {
            enabled: true,
            action: outcome.action,
            rows_merged: outcome.rows_merged,
            republished: outcome.republished,
        },
    })
}
