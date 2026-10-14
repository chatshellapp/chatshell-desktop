use super::AppState;
use tauri::State;

#[tauri::command]
pub async fn add_prompt_history_entry(
    state: State<'_, AppState>,
    content: String,
) -> Result<(), String> {
    state
        .db
        .add_prompt_history_entry(&content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_history(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    state
        .db
        .get_prompt_history()
        .await
        .map_err(|e| e.to_string())
}
