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

// ==========================================================================
// Sync enablement lifecycle (ADR 04 §7)
// ==========================================================================

use crate::sync_crypto_state;
use tauri::Manager;

/// Machine-readable error contract for the sync passphrase commands
/// (`unlock_sync`, `rotate_sync_key`). The frontend maps `code` to
/// user-facing copy — the same mapping the iOS app applies in
/// `SyncErrorCopy` — instead of surfacing raw error strings.
#[derive(Debug, thiserror::Error, Serialize)]
#[error("{message}")]
pub struct SyncCommandError {
    pub code: SyncErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncErrorCode {
    /// The entered passphrase does not unwrap the artifact slots (an AEAD
    /// open failure — wrong passphrase and tampered data are
    /// indistinguishable by design).
    WrongPassphrase,
    /// The remote artifact cannot be parsed: corrupt, or written by a newer
    /// app version (unknown format / key version).
    CorruptData,
    /// Anything else; `message` carries the raw detail for diagnostics.
    Failed,
}

impl SyncCommandError {
    /// Map a crypto-layer failure into the code the frontend renders.
    fn map_crypto(err: &anyhow::Error, context: &str) -> Self {
        use chatshell_agent_core::sync_crypto::SyncCryptoError;
        match err.downcast_ref::<SyncCryptoError>() {
            Some(SyncCryptoError::Auth | SyncCryptoError::WrongPassphrase) => Self {
                code: SyncErrorCode::WrongPassphrase,
                message: "wrong passphrase".into(),
            },
            Some(
                SyncCryptoError::Corrupt(_)
                | SyncCryptoError::UnsupportedFormat(_)
                | SyncCryptoError::UnknownKeyVersion(_),
            ) => Self {
                code: SyncErrorCode::CorruptData,
                message: err.to_string(),
            },
            _ => Self::failed(context, format_args!("{err:#}")),
        }
    }

    fn failed(context: &str, detail: impl std::fmt::Display) -> Self {
        Self {
            code: SyncErrorCode::Failed,
            message: format!("{context}: {detail}"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncSetupState {
    pub enabled: bool,
    pub onboarded: bool,
    /// The onboarding card should be shown (enabled never chosen, and the
    /// re-ask budget not exhausted: once more at next launch, then settings
    /// only — ADR 04 §7).
    pub needs_onboarding: bool,
    /// The non-blocking "history locked — enter sync passphrase" banner
    /// should be shown; the app stays fully usable meanwhile.
    pub needs_passphrase: bool,
    pub container_available: bool,
    /// A remote sync group already exists (encrypted artifact present):
    /// joining is the passphrase-unlock path, never a competing bootstrap
    /// (ADR 04 §3).
    pub group_exists: bool,
    pub engine_active: bool,
}

fn wiring(app: &tauri::AppHandle) -> Result<crate::sync::SyncWiring, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data_dir.join("data.db");
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("sync-stage");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    Ok(crate::sync::SyncWiring {
        app_data_dir,
        db_path,
        cache_dir,
    })
}

fn current_setup_state(app: &tauri::AppHandle, state: &AppState) -> Result<SyncSetupState, String> {
    let wiring = wiring(app)?;
    let settings = sync_crypto_state::load_settings(&wiring.app_data_dir);
    let container = crate::sync::resolve_sync_target(&wiring.app_data_dir);
    let group_exists = container
        .as_ref()
        .is_some_and(|(dir, _)| sync_crypto_state::artifact_path(dir).is_file());
    // Joining an existing group needs its passphrase regardless of the
    // enabled flag — a fresh device that never enabled sync must still see
    // the unlock surface (ADR 04 §3).
    let needs_passphrase = group_exists
        && container.as_ref().is_some_and(|(dir, _)| {
            matches!(
                sync_crypto_state::resolve_content_key(&wiring.app_data_dir, dir, &settings),
                sync_crypto_state::CkResolution::NeedPassphrase
            )
        });
    let engine_active = state
        .sync_engine
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false);
    Ok(SyncSetupState {
        enabled: settings.enabled,
        onboarded: settings.onboarded,
        needs_onboarding: !settings.onboarded && settings.declined_count < 2,
        needs_passphrase,
        container_available: container.is_some(),
        group_exists,
        engine_active,
    })
}

#[tauri::command]
pub async fn get_sync_setup_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SyncSetupState, String> {
    current_setup_state(&app, &state)
}

#[derive(Debug, Serialize)]
pub struct SyncPassphrase {
    pub passphrase: String,
}

/// Step 1 of the onboarding confirmation: generate the high-entropy
/// diceware-style group passphrase and show it once with save guidance
/// (ADR 04 §3). The frontend passes the user-confirmed passphrase back to
/// `complete_sync_onboarding`.
#[tauri::command]
pub async fn start_sync_onboarding() -> Result<SyncPassphrase, String> {
    Ok(SyncPassphrase {
        passphrase: chatshell_agent_core::sync_crypto::generate_passphrase(),
    })
}

/// Step 2: consent + passphrase bootstrap + enablement. One confirmation
/// merges the three jobs (ADR 04 §7): consent, CK bootstrap, and recovery
/// education (the UI copy around the passphrase display).
#[tauri::command]
pub async fn complete_sync_onboarding(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    passphrase: String,
) -> Result<SyncSetupState, String> {
    let passphrase = passphrase.trim().to_string();
    if passphrase.len() < 12 {
        return Err("Passphrase is too short".into());
    }
    let wiring = wiring(&app)?;
    let Some((cloud_dir, reason)) = crate::sync::resolve_sync_target(&wiring.app_data_dir) else {
        return Err("No sync target available (iCloud container absent)".into());
    };
    // A remote artifact means the sync group already exists — joining is
    // the passphrase-unlock path, never a competing mint (ADR 04 §3).
    if sync_crypto_state::artifact_path(&cloud_dir).is_file() {
        return Err(
            "A synced history already exists on this account — enter its              sync passphrase to join instead"
                .into(),
        );
    }
    let crypto = sync_crypto_state::bootstrap_group(&wiring.app_data_dir, &passphrase)
        .map_err(|e| format!("Failed to bootstrap sync encryption: {e:#}"))?;
    wiring
        .install_engine(&state.sync_engine, cloud_dir, crypto)
        .map_err(|e| format!("Failed to construct the sync engine: {e:#}"))?;
    let mut settings = sync_crypto_state::load_settings(&wiring.app_data_dir);
    settings.enabled = true;
    settings.onboarded = true;
    settings.needs_unlock = false;
    sync_crypto_state::save_settings(&wiring.app_data_dir, &settings).map_err(|e| e.to_string())?;
    tracing::info!("Sync enabled via onboarding ({reason})");
    // Ship the first pass without waiting for the startup-delayed tick.
    let engine = state.sync_engine.clone();
    let db = state.db.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = crate::sync::run_sync_pass(engine, db, handle).await {
            tracing::warn!("Post-onboarding sync pass failed: {err:?}");
        }
    });
    current_setup_state(&app, &state)
}

#[tauri::command]
pub async fn decline_sync_onboarding(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SyncSetupState, String> {
    let wiring = wiring(&app)?;
    let mut settings = sync_crypto_state::load_settings(&wiring.app_data_dir);
    settings.enabled = false;
    settings.declined_count += 1;
    sync_crypto_state::save_settings(&wiring.app_data_dir, &settings).map_err(|e| e.to_string())?;
    current_setup_state(&app, &state)
}
/// Ladder rung 4: the user entered the sync passphrase after the
/// "history locked" banner (or a settings unlock). Unwraps the artifact's
/// slot chain, persists it, and immediately runs a pass so the unlocked
/// history lands in this session.
#[tauri::command]
pub async fn unlock_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    passphrase: String,
) -> Result<SyncSetupState, SyncCommandError> {
    let wiring =
        wiring(&app).map_err(|e| SyncCommandError::failed("Failed to resolve the app paths", e))?;
    let Some((cloud_dir, _)) = crate::sync::resolve_sync_target(&wiring.app_data_dir) else {
        return Err(SyncCommandError::failed(
            "No sync target available",
            "iCloud container absent",
        ));
    };
    match sync_crypto_state::unlock_with_passphrase(&wiring.app_data_dir, &cloud_dir, &passphrase) {
        Ok(crypto) => {
            wiring
                .install_engine(&state.sync_engine, cloud_dir.clone(), crypto)
                .map_err(|e| {
                    SyncCommandError::failed(
                        "Failed to construct the sync engine",
                        format_args!("{e:#}"),
                    )
                })?;
            let mut settings = sync_crypto_state::load_settings(&wiring.app_data_dir);
            settings.enabled = true;
            settings.onboarded = true;
            settings.needs_unlock = false;
            sync_crypto_state::save_settings(&wiring.app_data_dir, &settings)
                .map_err(|e| SyncCommandError::failed("Failed to persist sync settings", e))?;
            let engine = state.sync_engine.clone();
            let db = state.db.clone();
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = crate::sync::run_sync_pass(engine.clone(), db, handle).await {
                    tracing::warn!("Post-unlock sync pass failed: {err:?}");
                }
                // Terminal flush for the join path: this device just
                // unlocked a group whose local state may be far ahead of
                // the remote snapshot (e.g. joining with years of local
                // history). `sync_now` may legitimately report up-to-date
                // against a stale remote counter and skip shipping — the
                // unthrottled publish here lands it immediately (the same
                // policy as the exit publish).
                if let Ok(mut guard) = engine.lock()
                    && let Some(engine) = guard.as_mut()
                    && let Err(err) = engine.publish()
                {
                    tracing::warn!("Post-unlock publish failed: {err}");
                }
            });
            current_setup_state(&app, &state)
                .map_err(|e| SyncCommandError::failed("Failed to read the sync state", e))
        }
        Err(err) => Err(SyncCommandError::map_crypto(&err, "Unlock failed")),
    }
}

/// Silent-join attempt for a device facing an existing sync group (ADR 04
/// §3 rung 1): when the graded ladder already resolves a usable key (iCloud
/// Keychain item propagated, or a cached chain), adoption + enablement
/// happen with zero user interaction — the passphrase input is the fallback
/// this command's error signals to the UI.
#[tauri::command]
pub async fn try_join_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SyncSetupState, String> {
    let wiring = wiring(&app)?;
    let Some((cloud_dir, _)) = crate::sync::resolve_sync_target(&wiring.app_data_dir) else {
        return Err("No sync target available".into());
    };
    if !sync_crypto_state::artifact_path(&cloud_dir).is_file() {
        return Err("No existing sync group on this account".into());
    }
    let settings = sync_crypto_state::load_settings(&wiring.app_data_dir);
    match sync_crypto_state::resolve_content_key(&wiring.app_data_dir, &cloud_dir, &settings) {
        sync_crypto_state::CkResolution::Ready(crypto) => {
            // Adoption from the ladder carries no proof the item is stale;
            // persist the chain only — never overwrite the keychain item.
            sync_crypto_state::persist_chain(&wiring.app_data_dir, &crypto)
                .map_err(|e| e.to_string())?;
            let mut settings = settings;
            settings.enabled = true;
            settings.onboarded = true;
            settings.needs_unlock = false;
            sync_crypto_state::save_settings(&wiring.app_data_dir, &settings)
                .map_err(|e| e.to_string())?;
            wiring
                .install_engine(&state.sync_engine, cloud_dir, crypto)
                .map_err(|e| format!("Failed to construct the sync engine: {e:#}"))?;
            let engine = state.sync_engine.clone();
            let db = state.db.clone();
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = crate::sync::run_sync_pass(engine.clone(), db, handle).await {
                    tracing::warn!("Post-join sync pass failed: {err:?}");
                }
                // The join path ships local state that may be far ahead of
                // the remote snapshot without waiting for quit/pool writes.
                if let Ok(mut guard) = engine.lock()
                    && let Some(engine) = guard.as_mut()
                    && let Err(err) = engine.publish()
                {
                    tracing::warn!("Post-join publish failed: {err}");
                }
            });
            tracing::info!("Joined existing sync group silently (ladder adoption)");
            current_setup_state(&app, &state)
        }
        _ => Err("Passphrase required".into()),
    }
}

/// Two-tier disable (ADR 04 §7): stop publishing (default — the peers' sync
/// group is untouched) versus delete my cloud data (destructive, separately
/// confirmed in the UI, multi-device warning).
#[tauri::command]
pub async fn disable_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    delete_cloud_data: bool,
) -> Result<String, String> {
    let wiring = wiring(&app)?;
    let cloud_dir = crate::sync::resolve_sync_target(&wiring.app_data_dir).map(|(dir, _)| dir);
    let summary = sync_crypto_state::disable_sync(
        &wiring.app_data_dir,
        cloud_dir.as_deref(),
        delete_cloud_data,
    )
    .map_err(|e| format!("Disable failed: {e:#}"))?;
    wiring.drop_engine(&state.sync_engine);
    Ok(summary)
}

/// Re-enable after onboarding was completed earlier (settings toggle).
#[tauri::command]
pub async fn enable_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SyncSetupState, String> {
    let wiring = wiring(&app)?;
    let mut settings = sync_crypto_state::load_settings(&wiring.app_data_dir);
    if !settings.onboarded {
        return Err("Complete onboarding first".into());
    }
    settings.enabled = true;
    sync_crypto_state::save_settings(&wiring.app_data_dir, &settings).map_err(|e| e.to_string())?;
    wiring.ensure_engine(&app, &state.sync_engine);
    current_setup_state(&app, &state)
}

/// Explicit content-key rotation (suspected compromise, lost device).
/// Forward-only revocation — see ADR 04 §5. Requires the group passphrase
/// to wrap the new key.
#[tauri::command]
pub async fn rotate_sync_key(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    passphrase: String,
) -> Result<String, SyncCommandError> {
    let wiring =
        wiring(&app).map_err(|e| SyncCommandError::failed("Failed to resolve the app paths", e))?;
    let cloud_dir = crate::sync::resolve_sync_target(&wiring.app_data_dir).map(|(dir, _)| dir);
    let Some(cloud_dir) = cloud_dir else {
        return Err(SyncCommandError::failed(
            "No sync target available",
            "iCloud container absent",
        ));
    };
    let crypto =
        sync_crypto_state::rotate_content_key(&wiring.app_data_dir, &cloud_dir, &passphrase)
            .map_err(|e| SyncCommandError::map_crypto(&e, "Rotation failed"))?;
    wiring
        .install_engine(&state.sync_engine, cloud_dir, crypto)
        .map_err(|e| {
            SyncCommandError::failed("Failed to construct the sync engine", format_args!("{e:#}"))
        })?;
    Ok(
        "Content key rotated. New snapshots and attachments are protected \
        from any holder of the old key; data written before the rotation \
        stays readable to them. Joining devices now need the sync \
        passphrase once (the iCloud key no longer updates after a rotation)."
            .into(),
    )
}
