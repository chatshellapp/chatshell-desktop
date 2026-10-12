use super::AppState;
use crate::models::Setting;
use tauri::State;

#[tauri::command]
pub async fn get_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    state.db.get_setting(&key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state
        .db
        .set_setting(&key, &value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_settings(state: State<'_, AppState>) -> Result<Vec<Setting>, String> {
    state.db.get_all_settings().await.map_err(|e| e.to_string())
}

/// Whether an obscura binary is installed on this machine. Gates the
/// "Always use Obscura" fetch-strategy option in settings.
#[tauri::command]
pub fn is_obscura_available() -> bool {
    crate::web_fetch::obscura_is_configured()
}

/// Whether a Chromium-family browser (Chrome/Chromium/Edge) is installed.
/// Gates the "Always use Chrome" fetch-strategy option in settings.
#[tauri::command]
pub fn is_chrome_available() -> bool {
    crate::web_fetch::chrome_is_available()
}

#[tauri::command]
pub async fn set_log_level(state: State<'_, AppState>, level: String) -> Result<(), String> {
    // Set the log level in the logger
    crate::logger::set_log_level(&level).map_err(|e| e.to_string())?;

    // Save the log level to database for persistence
    state
        .db
        .set_setting("log_level_rust", &level)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
