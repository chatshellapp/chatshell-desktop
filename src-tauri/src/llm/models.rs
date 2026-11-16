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

// Anthropic Models Response (GET /v1/models, cursor-paginated)
#[derive(Debug, Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<AnthropicModel>,
    #[serde(default)]
    has_more: bool,
    last_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicModel {
    id: String,
    display_name: Option<String>,
}

const ANTHROPIC_DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const ANTHROPIC_MODELS_PAGE_LIMIT: u32 = 1000;
/// Guard against a misbehaving proxy that keeps reporting `has_more`.
const ANTHROPIC_MODELS_MAX_PAGES: usize = 20;

/// Build the models endpoint the same way the chat client builds
/// `/v1/messages`: the base URL is the API root, with or without a trailing
/// `/v1` (proxies are often configured either way).
fn anthropic_models_url(base_url: Option<&str>) -> String {
    let base = base_url
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .unwrap_or(ANTHROPIC_DEFAULT_BASE_URL)
        .trim_end_matches('/');
    let base = base.strip_suffix("/v1").unwrap_or(base);
    format!("{base}/v1/models")
}

/// Fetch available models from Anthropic or an Anthropic-compatible API.
/// Authenticates with `x-api-key` + `anthropic-version` and follows the
/// `has_more` / `last_id` cursor until every page is read.
pub async fn fetch_anthropic_models(
    api_key: String,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>> {
    let client = create_http_client();
    let url = anthropic_models_url(base_url.as_deref());

    let mut models = Vec::new();
    let mut after_id: Option<String> = None;

    for _ in 0..ANTHROPIC_MODELS_MAX_PAGES {
        let mut page_url = reqwest::Url::parse(&url)?;
        {
            let mut query = page_url.query_pairs_mut();
            query.append_pair("limit", &ANTHROPIC_MODELS_PAGE_LIMIT.to_string());
            if let Some(cursor) = &after_id {
                query.append_pair("after_id", cursor);
            }
        }

        let response = client
            .get(page_url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "[HTTP {}] Failed to fetch Anthropic models: {}",
                status.as_u16(),
                body
            ));
        }

        let page: AnthropicModelsResponse = response.json().await?;
        models.extend(page.data.into_iter().map(|m| {
            let name = m
                .display_name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| format_model_display_name(&m.id));
            ModelInfo {
                id: m.id,
                name,
                description: None,
                context_length: None,
                pricing: None,
            }
        }));

        match (page.has_more, page.last_id) {
            (true, Some(last_id)) if after_id.as_deref() != Some(last_id.as_str()) => {
                after_id = Some(last_id);
            }
            _ => break,
        }
    }

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

    /// Serve one `200 OK` response per body, in order, on a single port,
    /// capturing each raw request (for paginated endpoints).
    async fn serve_model_pages(bodies: Vec<&'static str>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let captured = Arc::new(Mutex::new(Vec::new()));
        let sink = captured.clone();
        tokio::spawn(async move {
            for body in bodies {
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
                sink.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&request).to_string());
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        (format!("http://{address}"), captured)
    }

    #[test]
    fn anthropic_models_url_accepts_root_or_v1_base_urls() {
        assert_eq!(
            anthropic_models_url(None),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            anthropic_models_url(Some("  ")),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            anthropic_models_url(Some("https://proxy.example.com/")),
            "https://proxy.example.com/v1/models"
        );
        assert_eq!(
            anthropic_models_url(Some("https://proxy.example.com/anthropic/v1/")),
            "https://proxy.example.com/anthropic/v1/models"
        );
    }

    #[tokio::test]
    async fn fetch_anthropic_models_sends_anthropic_headers_and_uses_display_names() {
        let body = r#"{"data":[
            {"type":"model","id":"claude-opus-5-5","display_name":"Claude Opus 5.5","created_at":"2026-01-01T00:00:00Z"},
            {"type":"model","id":"claude-haiku-5-5","display_name":""}
        ],"has_more":false,"first_id":"claude-opus-5-5","last_id":"claude-haiku-5-5"}"#;
        let (base_url, captured) = serve_models("200 OK", body).await;

        let models = fetch_anthropic_models("test-key".to_string(), Some(base_url))
            .await
            .expect("fetch should succeed");

        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["claude-opus-5-5", "claude-haiku-5-5"]);
        assert_eq!(models[0].name, "Claude Opus 5.5");
        assert_eq!(
            models[1].name,
            format_model_display_name("claude-haiku-5-5")
        );

        let request = captured_request(&captured);
        assert!(
            request.starts_with("GET /v1/models?limit=1000 "),
            "got: {request}"
        );
        let lower = request.to_lowercase();
        assert!(lower.contains("x-api-key: test-key"), "got: {request}");
        assert!(
            lower.contains("anthropic-version: 2023-06-01"),
            "got: {request}"
        );
        assert!(!lower.contains("authorization:"), "got: {request}");
    }

    #[tokio::test]
    async fn fetch_anthropic_models_follows_pagination_cursor() {
        let (base_url, captured) = serve_model_pages(vec![
            r#"{"data":[{"id":"model-a","display_name":"Model A"}],"has_more":true,"last_id":"model-a"}"#,
            r#"{"data":[{"id":"model-b","display_name":"Model B"}],"has_more":false,"last_id":"model-b"}"#,
        ])
        .await;

        let models = fetch_anthropic_models("k".to_string(), Some(format!("{base_url}/v1")))
            .await
            .expect("fetch should succeed");

        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["model-a", "model-b"]);

        let requests = captured.lock().unwrap().clone();
        assert_eq!(requests.len(), 2);
        assert!(
            requests[1].starts_with("GET /v1/models?limit=1000&after_id=model-a "),
            "got: {}",
            requests[1]
        );
    }

    #[tokio::test]
    async fn fetch_anthropic_models_surfaces_http_error() {
        let (base_url, _) = serve_models(
            "401 Unauthorized",
            r#"{"type":"error","error":{"type":"authentication_error"}}"#,
        )
        .await;

        let err = fetch_anthropic_models("k".to_string(), Some(base_url))
            .await
            .unwrap_err();

        let msg = err.to_string();
        assert!(msg.contains("[HTTP 401]"), "got: {msg}");
        assert!(
            msg.contains("Failed to fetch Anthropic models"),
            "got: {msg}"
        );
        assert!(msg.contains("authentication_error"), "got: {msg}");
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
