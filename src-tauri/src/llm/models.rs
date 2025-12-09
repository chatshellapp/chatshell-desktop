use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::llm::common::{create_http_client, format_model_display_name};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub context_length: Option<i64>,
    pub pricing: Option<ModelPricing>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub prompt: Option<f64>,
    pub completion: Option<f64>,
}

// OpenAI Models Response
#[derive(Debug, Deserialize)]
struct OpenAIModelsResponse {
    data: Vec<OpenAIModel>,
}

#[derive(Debug, Deserialize)]
struct OpenAIModel {
    id: String,
}

// OpenRouter Models Response
#[derive(Debug, Deserialize)]
struct OpenRouterModelsResponse {
    data: Vec<OpenRouterModel>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterModel {
    id: String,
    name: String,
    description: Option<String>,
    context_length: Option<i64>,
    pricing: Option<OpenRouterPricing>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterPricing {
    prompt: Option<String>,
    completion: Option<String>,
}

// Ollama Models Response
#[derive(Debug, Deserialize)]
struct OllamaModelsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    name: String,
    model: String,
    size: Option<i64>,
}

/// Fetch available models from OpenAI
pub async fn fetch_openai_models(api_key: String) -> Result<Vec<ModelInfo>> {
    let client = create_http_client();

    let response = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to fetch OpenAI models"));
    }

    let data: OpenAIModelsResponse = response.json().await?;

    // Filter for chat models only
    let models: Vec<ModelInfo> = data
        .data
        .into_iter()
        .filter(|m| m.id.starts_with("gpt-"))
        .map(|m| {
            let display_name = format_model_display_name(&m.id);
            ModelInfo {
                id: m.id.clone(),
                name: display_name,
                description: None,
                context_length: None,
                pricing: None,
            }
        })
        .collect();

    Ok(models)
}

/// Fetch available models from OpenRouter
pub async fn fetch_openrouter_models(api_key: String) -> Result<Vec<ModelInfo>> {
    let client = create_http_client();

    let response = client
        .get("https://openrouter.ai/api/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to fetch OpenRouter models"));
    }

    let data: OpenRouterModelsResponse = response.json().await?;

    let models: Vec<ModelInfo> = data
        .data
        .into_iter()
        .map(|m| {
            let pricing = m.pricing.map(|p| ModelPricing {
                prompt: p.prompt.and_then(|s| s.parse::<f64>().ok()),
                completion: p.completion.and_then(|s| s.parse::<f64>().ok()),
            });

            ModelInfo {
                id: m.id.clone(),
                name: m.name,
                description: m.description,
                context_length: m.context_length,
                pricing,
            }
        })
        .collect();

    Ok(models)
}

/// Check if a model name indicates it's an embedding model
fn is_embedding_model(model_name: &str) -> bool {
    let lower_name = model_name.to_lowercase();
    
    // Common patterns for embedding models
    lower_name.starts_with("text-")
        || lower_name.contains("embed")
        || lower_name.starts_with("bge-")
        || lower_name.starts_with("e5-")
        || lower_name.starts_with("uae-")
        || lower_name.starts_with("gte-")
        || lower_name.contains("llm2vec")
        || lower_name.contains("retrieval")
        || lower_name.contains("jina-clip")
        || lower_name.contains("jina-embeddings")
        || lower_name.contains("voyage-")
        || lower_name.contains("rerank")
        || lower_name.contains("nomic-embed")
        || lower_name.contains("mxbai-embed")
}

/// Fetch available models from Ollama
pub async fn fetch_ollama_models(base_url: String) -> Result<Vec<ModelInfo>> {
    let client = create_http_client();

    let url = if base_url.ends_with('/') {
        format!("{}api/tags", base_url)
    } else {
        format!("{}/api/tags", base_url)
    };

    let response = client.get(&url).send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to fetch Ollama models"));
    }

    let data: OllamaModelsResponse = response.json().await?;

    let models: Vec<ModelInfo> = data
        .models
        .into_iter()
        // Filter out embedding models
        .filter(|m| !is_embedding_model(&m.name))
        .map(|m| {
            let display_name = format_model_display_name(&m.name);
            ModelInfo {
                id: m.name.clone(),
                name: display_name,
                description: m.size.map(|s| {
                    let gb = s as f64 / 1_073_741_824.0;
                    format!("Size: {:.2} GB", gb)
                }),
                context_length: None,
                pricing: None,
            }
        })
        .collect();

    Ok(models)
}
