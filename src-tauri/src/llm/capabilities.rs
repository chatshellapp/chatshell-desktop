use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelCapabilities {
    pub supports_tool_use: Option<bool>,
    pub supports_vision: Option<bool>,
    pub supports_image_generation: Option<bool>,
    pub supports_reasoning: Option<bool>,
    pub max_context_length: Option<i64>,
    pub max_output_length: Option<i64>,
}

/// Cache key: (provider_key, model_id)
type CacheKey = (String, String);

#[derive(Clone)]
pub struct CapabilitiesCache {
    entries: Arc<RwLock<HashMap<CacheKey, ModelCapabilities>>>,
}

// --- Raw JSON structures mirroring models.dev/api.json ---

#[derive(Debug, Deserialize)]
struct RawProvider {
    models: Option<HashMap<String, RawModel>>,
    #[allow(dead_code)]
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct RawModel {
    #[serde(default)]
    tool_call: Option<bool>,
    #[serde(default)]
    reasoning: Option<bool>,
    #[serde(default)]
    modalities: Option<RawModalities>,
    #[serde(default)]
    limit: Option<RawLimit>,
}

#[derive(Debug, Deserialize)]
struct RawModalities {
    #[serde(default)]
    input: Vec<String>,
    #[serde(default)]
    output: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RawLimit {
    context: Option<i64>,
    output: Option<i64>,
}

impl Default for CapabilitiesCache {
    fn default() -> Self {
        Self::new()
    }
}

impl CapabilitiesCache {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn load_from_bytes(&self, data: &[u8]) -> anyhow::Result<usize> {
        let providers: HashMap<String, RawProvider> = serde_json::from_slice(data)?;
        let mut map = HashMap::new();

        for (provider_key, provider) in &providers {
            if let Some(models) = &provider.models {
                for (model_id, raw) in models {
                    let caps = convert_raw_model(raw);
                    map.insert((provider_key.clone(), model_id.clone()), caps);
                }
            }
        }

        let count = map.len();
        *self.entries.write().await = map;
        Ok(count)
    }

    pub async fn load_from_file(path: &Path) -> anyhow::Result<Self> {
        let data = tokio::fs::read(path).await?;
        let cache = Self::new();
        let count = cache.load_from_bytes(&data).await?;
        tracing::info!(
            "Loaded {} model capability entries from {}",
            count,
            path.display()
        );
        Ok(cache)
    }

    pub async fn load_from_url(url: &str) -> anyhow::Result<Self> {
        let resp = reqwest::get(url).await?;
        let data = resp.bytes().await?;
        let cache = Self::new();
        let count = cache.load_from_bytes(&data).await?;
        tracing::info!("Loaded {} model capability entries from {}", count, url);
        Ok(cache)
    }

    /// Replace all entries from a freshly fetched source.
    pub async fn refresh_from_url(&self, url: &str) -> anyhow::Result<usize> {
        let resp = reqwest::get(url).await?;
        let data = resp.bytes().await?;
        self.load_from_bytes(&data).await
    }

    /// Resolve capabilities for a given provider type and model ID.
    ///
    /// Lookup strategy:
    /// 1. Direct match under the mapped provider key
    /// 2. For OpenRouter models (org/model format), also check the org's provider
    /// 3. Fallback: all-None (unknown = assume capable)
    pub async fn resolve(&self, provider_type: &str, model_id: &str) -> ModelCapabilities {
        let entries = self.entries.read().await;
        let provider_key = map_provider_type(provider_type);

        // 1. Direct match
        if let Some(caps) = entries.get(&(provider_key.to_string(), model_id.to_string())) {
            return caps.clone();
        }

        // 2. For OpenRouter-style "org/model" IDs, try looking under the org provider
        if let Some(slash_pos) = model_id.find('/') {
            let org = &model_id[..slash_pos];
            let org_provider_key = map_provider_type(org);
            let bare_model = &model_id[slash_pos + 1..];

            // Try org_provider / bare_model (e.g. "google" / "gemini-2.5-flash")
            if let Some(caps) = entries.get(&(org_provider_key.to_string(), bare_model.to_string()))
            {
                return caps.clone();
            }

            // Try org_provider / full_id (e.g. "google" / "google/gemini-2.5-flash")
            if let Some(caps) = entries.get(&(org_provider_key.to_string(), model_id.to_string())) {
                return caps.clone();
            }
        }

        // 3. Fuzzy: try all providers for this model_id (handles aliases)
        for ((_prov, mid), caps) in entries.iter() {
            if mid == model_id {
                return caps.clone();
            }
        }

        // 4. Fallback: unknown
        ModelCapabilities::default()
    }
}

fn convert_raw_model(raw: &RawModel) -> ModelCapabilities {
    let supports_vision = raw
        .modalities
        .as_ref()
        .map(|m| m.input.iter().any(|s| s == "image") || m.input.iter().any(|s| s == "video"));

    let supports_image_generation = raw
        .modalities
        .as_ref()
        .map(|m| m.output.iter().any(|s| s == "image"));

    ModelCapabilities {
        supports_tool_use: raw.tool_call,
        supports_vision,
        supports_image_generation,
        supports_reasoning: raw.reasoning,
        max_context_length: raw.limit.as_ref().and_then(|l| l.context),
        max_output_length: raw.limit.as_ref().and_then(|l| l.output),
    }
}

/// Map our internal provider_type string to the models.dev provider key.
fn map_provider_type(provider_type: &str) -> &str {
    match provider_type {
        "gemini" => "google",
        "custom_openai" => "openai",
        "custom_anthropic" => "anthropic",
        _ => provider_type,
    }
}

pub const MODELS_DEV_URL: &str = "https://models.dev/api.json";
