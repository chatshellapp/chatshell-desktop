use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Provider {
    pub id: String,
    pub name: String,          // Display name, e.g., "Ollama Local", "OpenAI"
    pub provider_type: String, // Type: ollama, openai, openrouter
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub description: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProviderRequest {
    pub name: String,
    pub provider_type: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub description: Option<String>,
    pub is_enabled: Option<bool>,
}

