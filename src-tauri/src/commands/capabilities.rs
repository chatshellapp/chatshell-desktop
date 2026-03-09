use super::AppState;
use crate::llm::capabilities::{ModelCapabilities, MODELS_DEV_URL};
use tauri::State;

#[tauri::command]
pub async fn get_model_capabilities(
    state: State<'_, AppState>,
    provider_type: String,
    model_id: String,
) -> Result<ModelCapabilities, String> {
    Ok(state
        .capabilities_cache
        .resolve(&provider_type, &model_id)
        .await)
}

#[tauri::command]
pub async fn refresh_capabilities_cache(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let count = state
        .capabilities_cache
        .refresh_from_url(MODELS_DEV_URL)
        .await
        .map_err(|e| format!("Failed to refresh capabilities: {}", e))?;
    tracing::info!(
        "Refreshed model capabilities cache: {} entries loaded from {}",
        count,
        MODELS_DEV_URL
    );
    Ok(count)
}
