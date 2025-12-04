use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::llm::common::create_http_client;

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
        .map(|m| ModelInfo {
            id: m.id.clone(),
            name: m.id,
            description: None,
            context_length: None,
            pricing: None,
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

/// Format Ollama model ID to a human-friendly display name
/// Example: "gemma3:4b" -> "Gemma 3 4B"
fn format_ollama_model_name(model_id: &str) -> String {
    // Split by colon to separate model name and size
    let parts: Vec<&str> = model_id.split(':').collect();
    let base_name = parts[0];
    let size = parts.get(1).map(|s| s.to_uppercase());

    // Format the base name
    let formatted_base = base_name
        .split('-')
        .map(|part| {
            // Handle special cases for numbers
            if part.chars().all(|c| c.is_ascii_digit()) {
                part.to_string()
            } else if part.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                // Contains numbers mixed with letters (e.g., "gemma3" -> "Gemma 3")
                let mut result = String::new();
                let mut chars = part.chars().peekable();
                let mut is_first = true;

                while let Some(ch) = chars.next() {
                    if ch.is_ascii_digit() {
                        if !result.is_empty() && !result.ends_with(' ') {
                            result.push(' ');
                        }
                        result.push(ch);
                    } else {
                        if is_first {
                            result.push(ch.to_ascii_uppercase());
                            is_first = false;
                        } else {
                            result.push(ch);
                        }
                    }
                }
                result
            } else {
                // Regular word - capitalize first letter
                let mut chars = part.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                }
            }
        })
        .collect::<Vec<String>>()
        .join(" ");

    // Combine with size if present
    if let Some(size_str) = size {
        format!("{} {}", formatted_base, size_str)
    } else {
        formatted_base
    }
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
        .map(|m| {
            let display_name = format_ollama_model_name(&m.name);
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
