use crate::llm;
pub use crate::llm::models::ModelInfo;

#[tauri::command]
pub async fn fetch_openai_models(api_key: String) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_openai_models(api_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_openrouter_models(api_key: String) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_openrouter_models(api_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_ollama_models(base_url: String) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_ollama_models(base_url)
        .await
        .map_err(|e| e.to_string())
}
