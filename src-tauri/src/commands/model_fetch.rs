use crate::llm;
pub use crate::llm::models::ModelInfo;

#[tauri::command]
pub async fn fetch_openai_models(
    api_key: String,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_openai_models(api_key, base_url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_openrouter_models(
    api_key: String,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_openrouter_models(api_key, base_url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_ollama_models(base_url: String) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_ollama_models(base_url)
        .await
        .map_err(|e| e.to_string())
}

/// Generic model fetch for providers with OpenAI-compatible /models endpoint.
/// Supports: deepseek, groq, together, xai, moonshot, perplexity, hyperbolic, mistral, mira,
/// galadriel, cohere
#[tauri::command]
pub async fn fetch_provider_models(
    provider_type: String,
    api_key: String,
    base_url: String,
) -> Result<Vec<ModelInfo>, String> {
    llm::models::fetch_openai_compatible_models(api_key, base_url, &provider_type)
        .await
        .map_err(|e| e.to_string())
}
