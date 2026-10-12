use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
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

    /// Parse a models.dev api.json payload into cache entries.
    fn parse_entries(data: &[u8]) -> anyhow::Result<HashMap<CacheKey, ModelCapabilities>> {
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

        Ok(map)
    }

    pub async fn load_from_bytes(&self, data: &[u8]) -> anyhow::Result<usize> {
        let map = Self::parse_entries(data)?;
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

    /// Load the preferred snapshot: a previously persisted refresh wins over
    /// the copy bundled with the app; a missing or corrupt persisted file
    /// falls back to the bundled resource.
    pub async fn load_preferred(persisted: &Path, bundled: &Path) -> anyhow::Result<Self> {
        match Self::load_from_file(persisted).await {
            Ok(cache) => {
                tracing::info!(
                    "Using persisted model capabilities snapshot at {}",
                    persisted.display()
                );
                Ok(cache)
            }
            Err(e) => {
                tracing::warn!(
                    "Persisted model capabilities unusable ({}: {}); falling back to bundled {}",
                    persisted.display(),
                    e,
                    bundled.display()
                );
                Self::load_from_file(bundled).await
            }
        }
    }

    /// Validate a payload, persist it to `persist_path`, then install it.
    /// A malformed payload never replaces a previously persisted snapshot.
    pub async fn install_and_persist(
        &self,
        data: &[u8],
        persist_path: &Path,
    ) -> anyhow::Result<usize> {
        let map = Self::parse_entries(data)?;
        if let Some(parent) = persist_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(persist_path, data).await?;
        let count = map.len();
        *self.entries.write().await = map;
        Ok(count)
    }

    /// Replace all entries from a freshly fetched source and persist the raw
    /// snapshot so subsequent launches load it instead of the bundled copy.
    pub async fn refresh_from_url_persisted(
        &self,
        url: &str,
        persist_path: &Path,
    ) -> anyhow::Result<usize> {
        let resp = reqwest::get(url).await?;
        let data = resp.bytes().await?;
        self.install_and_persist(&data, persist_path).await
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

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(model_id: &str, tool_call: bool) -> Vec<u8> {
        serde_json::json!({
            "test-provider": {
                "models": {
                    model_id: {
                        "tool_call": tool_call,
                        "reasoning": false,
                        "limit": { "context": 4096, "output": 1024 },
                        "modalities": { "input": ["text", "image"], "output": ["text"] }
                    }
                }
            }
        })
        .to_string()
        .into_bytes()
    }

    #[tokio::test]
    async fn load_preferred_uses_persisted_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let persisted = dir.path().join("persisted.json");
        let bundled = dir.path().join("bundled.json");
        std::fs::write(&persisted, payload("persisted-model", true)).unwrap();
        std::fs::write(&bundled, payload("bundled-model", false)).unwrap();

        let cache = CapabilitiesCache::load_preferred(&persisted, &bundled)
            .await
            .unwrap();

        assert_eq!(
            cache
                .resolve("test-provider", "persisted-model")
                .await
                .supports_tool_use,
            Some(true)
        );
        // The bundled entry must not leak through when a persisted copy exists.
        assert_eq!(
            cache
                .resolve("test-provider", "bundled-model")
                .await
                .supports_tool_use,
            None
        );
    }

    #[tokio::test]
    async fn load_preferred_falls_back_to_bundled_when_persisted_unusable() {
        let dir = tempfile::tempdir().unwrap();
        let bundled = dir.path().join("bundled.json");
        std::fs::write(&bundled, payload("bundled-model", false)).unwrap();

        // Corrupt persisted file
        let corrupt = dir.path().join("corrupt.json");
        std::fs::write(&corrupt, b"not json").unwrap();
        let cache = CapabilitiesCache::load_preferred(&corrupt, &bundled)
            .await
            .unwrap();
        assert_eq!(
            cache
                .resolve("test-provider", "bundled-model")
                .await
                .supports_tool_use,
            Some(false)
        );

        // Missing persisted file
        let missing = dir.path().join("missing.json");
        let cache = CapabilitiesCache::load_preferred(&missing, &bundled)
            .await
            .unwrap();
        assert_eq!(
            cache
                .resolve("test-provider", "bundled-model")
                .await
                .supports_tool_use,
            Some(false)
        );
    }

    #[tokio::test]
    async fn install_and_persist_validates_before_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("snapshots").join("models_dev.json");
        let cache = CapabilitiesCache::new();

        let count = cache
            .install_and_persist(&payload("m1", true), &path)
            .await
            .unwrap();
        assert_eq!(count, 1);
        assert!(path.is_file());

        // A malformed refresh must fail without clobbering disk or memory.
        assert!(cache.install_and_persist(b"garbage", &path).await.is_err());
        assert_eq!(
            cache.resolve("test-provider", "m1").await.supports_tool_use,
            Some(true)
        );
        let on_disk: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(on_disk["test-provider"]["models"]["m1"].is_object());
    }
}
