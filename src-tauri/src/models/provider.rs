use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct Provider {
    pub id: String,
    pub name: String,          // Display name, e.g., "Ollama Local", "OpenAI"
    pub provider_type: String, // Type: ollama, openai, openrouter, custom_openai, custom_anthropic
    #[ts(optional)]
    pub api_key: Option<String>,
    #[ts(optional)]
    pub base_url: Option<String>,
    #[ts(optional)]
    pub api_style: Option<String>, // "responses" | "chat_completions" (only for custom_openai)
    #[ts(optional)]
    pub description: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateProviderRequest {
    pub name: String,
    pub provider_type: String,
    #[ts(optional)]
    pub api_key: Option<String>,
    #[ts(optional)]
    pub base_url: Option<String>,
    #[ts(optional)]
    pub api_style: Option<String>,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub is_enabled: Option<bool>,
}
