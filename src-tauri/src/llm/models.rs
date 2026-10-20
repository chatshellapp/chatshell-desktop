use anyhow::Result;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::llm::common::{create_http_client, format_model_display_name};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub context_length: Option<i64>,
    #[ts(optional)]
    pub pricing: Option<ModelPricing>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModelPricing {
    #[ts(optional)]
    pub prompt: Option<f64>,
    #[ts(optional)]
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
    size: Option<i64>,
}

/// Fetch available models from OpenAI
pub async fn fetch_openai_models(
    api_key: String,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>> {
    let client = create_http_client();

    let url = base_url.as_deref().unwrap_or("https://api.openai.com/v1");
    let url = if url.ends_with('/') {
        format!("{}models", url)
    } else {
        format!("{}/models", url)
    };

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!(
            "[HTTP {}] Failed to fetch OpenAI models: {}",
            status.as_u16(),
            body
        ));
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

/// Generic fetch for providers with OpenAI-compatible /models endpoint (Bearer auth).
/// Used by DeepSeek, Groq, Together, xAI, Moonshot, Perplexity, Hyperbolic, Mistral, etc.
pub async fn fetch_openai_compatible_models(
    api_key: String,
    base_url: String,
    provider_name: &str,
) -> Result<Vec<ModelInfo>> {
    let client = create_http_client();

    let url = if base_url.ends_with('/') {
        format!("{}models", base_url)
    } else {
        format!("{}/models", base_url)
    };

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!(
            "[HTTP {}] Failed to fetch {} models: {}",
            status.as_u16(),
            provider_name,
            body
        ));
    }

    let data: OpenAIModelsResponse = response.json().await?;

    let models: Vec<ModelInfo> = data
        .data
        .into_iter()
        .filter(|m| !is_embedding_model(&m.id))
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
pub async fn fetch_openrouter_models(
    api_key: String,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>> {
    let client = create_http_client();

    let url = base_url
        .as_deref()
        .unwrap_or("https://openrouter.ai/api/v1");
    let url = if url.ends_with('/') {
        format!("{}models", url)
    } else {
        format!("{}/models", url)
    };

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!(
            "[HTTP {}] Failed to fetch OpenRouter models: {}",
            status.as_u16(),
            body
        ));
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
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!(
            "[HTTP {}] Failed to fetch Ollama models: {}",
            status.as_u16(),
            body
        ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    /// Serve exactly one request with `status`/`body`, capturing the raw
    /// request bytes for assertions (same convention as the `image_question`
    /// and `web_fetch` tests: bind an ephemeral 127.0.0.1 port, answer one
    /// request with a raw HTTP/1.1 response, close).
    async fn serve_models(
        status: &'static str,
        body: &'static str,
    ) -> (String, Arc<Mutex<Vec<u8>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let captured = Arc::new(Mutex::new(Vec::new()));
        let sink = captured.clone();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 8192];
            loop {
                let n = socket.read(&mut chunk).await.unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..n]);
                if find_subsequence(&request, b"\r\n\r\n").is_some() {
                    break;
                }
            }
            *sink.lock().unwrap() = request;
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        (format!("http://{address}"), captured)
    }

    fn captured_request(captured: &Arc<Mutex<Vec<u8>>>) -> String {
        let bytes = captured.lock().unwrap().clone();
        String::from_utf8_lossy(&bytes).to_string()
    }

    #[test]
    fn is_embedding_model_detects_embedding_families_case_insensitively() {
        for name in [
            "text-embedding-3-small",
            "TEXT-EMBEDDING-3-LARGE",
            "bge-m3",
            "e5-large-v2",
            "uae-large-v1",
            "gte-base",
            "llm2vec-7b",
            "Snowflake-arctic-embed-l",
            "cohere-rerank-v3",
            "jina-clip-v1",
            "jina-embeddings-v3",
            "voyage-3-lite",
            "nomic-embed-text",
            "mxbai-embed-large",
            "some-model-retrieval-1",
        ] {
            assert!(
                is_embedding_model(name),
                "should classify as embedding: {name}"
            );
        }
    }

    #[test]
    fn is_embedding_model_keeps_chat_models() {
        for name in [
            "gpt-4o",
            "deepseek-chat",
            "claude-3-5-sonnet",
            "llama3.2:3b",
            "qwen-max",
            "mixtral-8x7b",
        ] {
            assert!(!is_embedding_model(name), "should classify as chat: {name}");
        }
    }

    #[tokio::test]
    async fn fetch_openai_models_keeps_gpt_models_and_sends_bearer_auth() {
        let body = r#"{"data":[
            {"id":"gpt-4o"},
            {"id":"gpt-4o-mini"},
            {"id":"text-embedding-3-small"},
            {"id":"davinci-002"}
        ]}"#;
        let (base_url, captured) = serve_models("200 OK", body).await;

        let models = fetch_openai_models("test-key".to_string(), Some(format!("{base_url}/v1")))
            .await
            .unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-4o");
        assert_eq!(models[0].name, "GPT 4o");
        assert_eq!(models[1].id, "gpt-4o-mini");
        assert_eq!(models[1].name, "GPT 4o Mini");
        for m in &models {
            assert!(m.description.is_none());
            assert!(m.context_length.is_none());
            assert!(m.pricing.is_none());
        }

        let request = captured_request(&captured);
        assert!(request.starts_with("GET /v1/models "), "got: {request}");
        assert!(
            request
                .to_lowercase()
                .contains("authorization: bearer test-key")
        );
    }

    #[tokio::test]
    async fn fetch_openai_models_joins_trailing_slash_base_url() {
        let (base_url, captured) = serve_models("200 OK", r#"{"data":[]}"#).await;

        let models = fetch_openai_models("k".to_string(), Some(format!("{base_url}/v1/")))
            .await
            .unwrap();

        assert!(models.is_empty());
        let request = captured_request(&captured);
        assert!(request.starts_with("GET /v1/models "), "got: {request}");
    }

    #[tokio::test]
    async fn fetch_openai_models_surfaces_http_error_with_body() {
        let (base_url, _) = serve_models("401 Unauthorized", "bad key").await;

        let err = fetch_openai_models("k".to_string(), Some(base_url))
            .await
            .unwrap_err();

        let msg = err.to_string();
        assert!(msg.contains("[HTTP 401]"), "got: {msg}");
        assert!(msg.contains("Failed to fetch OpenAI models"), "got: {msg}");
        assert!(msg.contains("bad key"), "got: {msg}");
    }

    #[tokio::test]
    async fn fetch_openai_models_rejects_malformed_json() {
        let (base_url, _) = serve_models("200 OK", "not json").await;

        assert!(
            fetch_openai_models("k".to_string(), Some(base_url))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn fetch_openai_compatible_models_filters_embeddings_and_formats_names() {
        let body = r#"{"data":[
            {"id":"deepseek-chat"},
            {"id":"text-embedding-3-large"},
            {"id":"deepseek-reasoner"},
            {"id":"deepseek-reranker"}
        ]}"#;
        let (base_url, _) = serve_models("200 OK", body).await;

        let models =
            fetch_openai_compatible_models("k".to_string(), format!("{base_url}/v1"), "DeepSeek")
                .await
                .unwrap();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "deepseek-chat");
        assert_eq!(models[0].name, "Deepseek Chat");
        assert_eq!(models[1].id, "deepseek-reasoner");
        assert_eq!(models[1].name, "Deepseek Reasoner");
        for m in &models {
            assert!(m.pricing.is_none());
        }
    }

    #[tokio::test]
    async fn fetch_openai_compatible_models_error_names_the_provider() {
        let (base_url, _) = serve_models("500 Internal Server Error", "boom").await;

        let err = fetch_openai_compatible_models("k".to_string(), base_url, "Groq")
            .await
            .unwrap_err();

        let msg = err.to_string();
        assert!(msg.contains("[HTTP 500]"), "got: {msg}");
        assert!(msg.contains("Failed to fetch Groq models"), "got: {msg}");
        assert!(msg.contains("boom"), "got: {msg}");
    }

    #[tokio::test]
    async fn fetch_openrouter_models_maps_metadata_and_parses_pricing() {
        let body = r#"{"data":[
            {
                "id":"anthropic/claude-3.5-sonnet",
                "name":"Claude 3.5 Sonnet",
                "description":"Claude Sonnet",
                "context_length":200000,
                "pricing":{"prompt":"0.000003","completion":"0.000015"}
            },
            {
                "id":"x/y",
                "name":"Y",
                "pricing":{"prompt":"not-a-number","completion":null}
            },
            {"id":"z/w","name":"W"}
        ]}"#;
        let (base_url, captured) = serve_models("200 OK", body).await;

        let models = fetch_openrouter_models("k".to_string(), Some(format!("{base_url}/api/v1")))
            .await
            .unwrap();

        assert_eq!(models.len(), 3);
        // Full metadata passthrough with parsed pricing.
        assert_eq!(models[0].id, "anthropic/claude-3.5-sonnet");
        assert_eq!(models[0].name, "Claude 3.5 Sonnet");
        assert_eq!(models[0].description.as_deref(), Some("Claude Sonnet"));
        assert_eq!(models[0].context_length, Some(200000));
        let pricing = models[0].pricing.as_ref().unwrap();
        assert_eq!(pricing.prompt, Some(0.000003));
        assert_eq!(pricing.completion, Some(0.000015));
        // Unparseable / null pricing fields degrade to None.
        let pricing = models[1].pricing.as_ref().unwrap();
        assert_eq!(pricing.prompt, None);
        assert_eq!(pricing.completion, None);
        // Missing pricing object stays absent.
        assert!(models[2].pricing.is_none());

        let request = captured_request(&captured);
        assert!(request.starts_with("GET /api/v1/models "), "got: {request}");
    }

    #[tokio::test]
    async fn fetch_openrouter_models_surfaces_http_error() {
        let (base_url, _) = serve_models("403 Forbidden", "denied").await;

        let err = fetch_openrouter_models("k".to_string(), Some(base_url))
            .await
            .unwrap_err();

        let msg = err.to_string();
        assert!(msg.contains("[HTTP 403]"), "got: {msg}");
        assert!(
            msg.contains("Failed to fetch OpenRouter models"),
            "got: {msg}"
        );
        assert!(msg.contains("denied"), "got: {msg}");
    }

    #[tokio::test]
    async fn fetch_ollama_models_lists_local_models_with_human_sizes() {
        let body = r#"{"models":[
            {"name":"llama3.2:3b","size":2019390189},
            {"name":"nomic-embed-text","size":274302450},
            {"name":"qwen3:8b"}
        ]}"#;
        let (base_url, captured) = serve_models("200 OK", body).await;

        let models = fetch_ollama_models(format!("{base_url}/")).await.unwrap();

        assert_eq!(models.len(), 2); // embedding model filtered out
        assert_eq!(models[0].id, "llama3.2:3b");
        // Only leading acronyms/digits are split; "llama3.2" stays glued.
        assert_eq!(models[0].name, "Llama3.2 3B");
        assert_eq!(
            models[0].description.as_deref(),
            Some("Size: 1.88 GB") // 2019390189 / 1024^3 = 1.88
        );
        assert_eq!(models[1].id, "qwen3:8b");
        assert_eq!(models[1].description, None); // no size reported

        let request = captured_request(&captured);
        assert!(request.starts_with("GET /api/tags "), "got: {request}");
    }

    #[tokio::test]
    async fn fetch_ollama_models_surfaces_http_error() {
        let (base_url, _) = serve_models("500 Internal Server Error", "oops").await;

        let err = fetch_ollama_models(base_url).await.unwrap_err();

        let msg = err.to_string();
        assert!(msg.contains("[HTTP 500]"), "got: {msg}");
        assert!(msg.contains("Failed to fetch Ollama models"), "got: {msg}");
        assert!(msg.contains("oops"), "got: {msg}");
    }
}
