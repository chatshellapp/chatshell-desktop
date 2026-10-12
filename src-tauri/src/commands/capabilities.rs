use super::AppState;
use crate::llm::capabilities::{MODELS_DEV_URL, ModelCapabilities};
use tauri::Manager as _;
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let persist_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("models_dev.json");
    let count = state
        .capabilities_cache
        .refresh_from_url_persisted(MODELS_DEV_URL, &persist_path)
        .await
        .map_err(|e| format!("Failed to refresh capabilities: {}", e))?;
    tracing::info!(
        "Refreshed model capabilities cache: {} entries loaded from {} (persisted to {})",
        count,
        MODELS_DEV_URL,
        persist_path.display()
    );
    Ok(count)
}
