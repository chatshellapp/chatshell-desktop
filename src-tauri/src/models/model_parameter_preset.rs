use serde::{Deserialize, Serialize};

/// Model Parameter Preset - Reusable configuration for LLM generation parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelParameterPreset {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Controls randomness in output (0.0 = deterministic, 2.0 = very random)
    pub temperature: Option<f64>,
    /// Maximum number of tokens to generate
    pub max_tokens: Option<i64>,
    /// Nucleus sampling: only consider tokens with top_p cumulative probability
    pub top_p: Option<f64>,
    /// Penalize tokens based on their frequency in the text so far
    pub frequency_penalty: Option<f64>,
    /// Penalize tokens that have already appeared in the text
    pub presence_penalty: Option<f64>,
    /// Additional provider-specific parameters (JSON)
    pub additional_params: Option<serde_json::Value>,
    /// System preset (cannot be deleted/modified by user)
    pub is_system: bool,
    /// Default preset (automatically selected for new assistants)
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateModelParameterPresetRequest {
    pub name: String,
    pub description: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub additional_params: Option<serde_json::Value>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateModelParameterPresetRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub additional_params: Option<serde_json::Value>,
    pub is_default: Option<bool>,
}
