use crate::llm;
use crate::llm::StreamChunkType;
use crate::llm::agent_builder::{
    AgentConfig, build_user_message, create_provider_agent, stream_chat_with_agent,
};
pub use crate::llm::models::ModelInfo;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

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

#[derive(Debug, Serialize)]
pub struct CheckApiResult {
    pub success: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

/// Check provider API connectivity by sending a minimal request.
/// Sends "hi" to the model, aborts on first successful chunk to minimize token usage.
#[tauri::command]
pub async fn check_provider_api(
    provider_type: String,
    model_id: String,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
) -> Result<CheckApiResult, String> {
    let start = std::time::Instant::now();

    let config = AgentConfig::new().with_system_prompt("You are a helpful assistant.".to_string());

    let agent = create_provider_agent(
        &provider_type,
        &model_id,
        api_key.as_deref(),
        base_url.as_deref(),
        api_style.as_deref(),
        &config,
    )
    .map_err(|e| e.to_string())?;

    let prompt = build_user_message("hi", &[], &[]);
    let cancel_token = CancellationToken::new();
    let cancel_clone = cancel_token.clone();

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        stream_chat_with_agent(
            agent,
            prompt,
            vec![],
            cancel_token,
            move |_chunk, chunk_type| {
                if matches!(
                    chunk_type,
                    StreamChunkType::Text | StreamChunkType::Reasoning
                ) {
                    cancel_clone.cancel();
                }
                true
            },
            "check-api",
        ),
    )
    .await;

    let latency_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(_)) => Ok(CheckApiResult {
            success: true,
            latency_ms,
            error: None,
        }),
        Ok(Err(e)) => {
            let err_str = e.to_string();
            if err_str.contains("cancelled") || err_str.contains("canceled") {
                Ok(CheckApiResult {
                    success: true,
                    latency_ms,
                    error: None,
                })
            } else {
                Ok(CheckApiResult {
                    success: false,
                    latency_ms,
                    error: Some(err_str),
                })
            }
        }
        Err(_) => Ok(CheckApiResult {
            success: false,
            latency_ms,
            error: Some("Connection timed out (30s)".to_string()),
        }),
    }
}
