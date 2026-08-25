use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Model Parameter Preset - Reusable configuration for LLM generation parameters
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModelParameterPreset {
    pub id: String,
    pub name: String,
    #[ts(optional)]
    pub description: Option<String>,
    /// Controls randomness in output (0.0 = deterministic, 2.0 = very random)
    #[ts(optional)]
    pub temperature: Option<f64>,
    /// Maximum number of tokens to generate
    #[ts(optional)]
    pub max_tokens: Option<i64>,
    /// Nucleus sampling: only consider tokens with top_p cumulative probability
    #[ts(optional)]
    pub top_p: Option<f64>,
    /// Penalize tokens based on their frequency in the text so far
    #[ts(optional)]
    pub frequency_penalty: Option<f64>,
    /// Penalize tokens that have already appeared in the text
    #[ts(optional)]
    pub presence_penalty: Option<f64>,
    /// Additional provider-specific parameters (JSON)
    #[ts(optional)]
    #[ts(type = "unknown")]
    pub additional_params: Option<serde_json::Value>,
    /// System preset (cannot be deleted/modified by user)
    pub is_system: bool,
    /// Default preset (automatically selected for new assistants)
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateModelParameterPresetRequest {
    pub name: String,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub temperature: Option<f64>,
    #[ts(optional)]
    pub max_tokens: Option<i64>,
    #[ts(optional)]
    pub top_p: Option<f64>,
    #[ts(optional)]
    pub frequency_penalty: Option<f64>,
    #[ts(optional)]
    pub presence_penalty: Option<f64>,
    #[ts(optional)]
    #[ts(type = "unknown")]
    pub additional_params: Option<serde_json::Value>,
    #[ts(optional)]
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateModelParameterPresetRequest {
    #[ts(optional)]
    pub name: Option<String>,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub temperature: Option<f64>,
    #[ts(optional)]
    pub max_tokens: Option<i64>,
    #[ts(optional)]
    pub top_p: Option<f64>,
    #[ts(optional)]
    pub frequency_penalty: Option<f64>,
    #[ts(optional)]
    pub presence_penalty: Option<f64>,
    #[ts(optional)]
    #[ts(type = "unknown")]
    pub additional_params: Option<serde_json::Value>,
    #[ts(optional)]
    pub is_default: Option<bool>,
}
