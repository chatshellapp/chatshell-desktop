use super::AppState;
use crate::models::{
    CreateModelParameterPresetRequest, ModelParameterPreset, UpdateModelParameterPresetRequest,
};
use tauri::State;

#[tauri::command]
pub async fn list_model_parameter_presets(
    state: State<'_, AppState>,
) -> Result<Vec<ModelParameterPreset>, String> {
    state
        .db
        .list_model_parameter_presets()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_model_parameter_preset(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ModelParameterPreset>, String> {
    state
        .db
        .get_model_parameter_preset(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_default_model_parameter_preset(
    state: State<'_, AppState>,
) -> Result<Option<ModelParameterPreset>, String> {
    state
        .db
        .get_default_model_parameter_preset()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_model_parameter_preset(
    state: State<'_, AppState>,
    req: CreateModelParameterPresetRequest,
) -> Result<ModelParameterPreset, String> {
    state
        .db
        .create_model_parameter_preset(req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_model_parameter_preset(
    state: State<'_, AppState>,
    id: String,
    req: UpdateModelParameterPresetRequest,
) -> Result<ModelParameterPreset, String> {
    state
        .db
        .update_model_parameter_preset(&id, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_model_parameter_preset(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state
        .db
        .delete_model_parameter_preset(&id)
        .await
        .map_err(|e| e.to_string())
}
