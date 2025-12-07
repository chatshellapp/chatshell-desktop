use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: String,
    pub name: String,        // Display name, e.g., "DeepSeek R1 14B"
    pub provider_id: String, // Foreign key to providers table
    pub model_id: String,    // Actual model identifier, e.g., "deepseek-r1:14b"
    pub description: Option<String>,
    pub is_starred: bool, // Whether model is starred for quick access
    pub is_deleted: bool, // Soft delete flag
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateModelRequest {
    pub name: String,
    pub provider_id: String,
    pub model_id: String,
    pub description: Option<String>,
    pub is_starred: Option<bool>,
}

// ==========================================================================
// MODEL PARAMETERS - Reusable LLM generation configuration
// ==========================================================================

/// Model parameters for LLM configuration.
/// These parameters control the behavior of the language model during generation.
/// Can be used independently (for direct model calls) or embedded in an Assistant.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelParameters {
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
}

impl ModelParameters {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if any parameters are set (used to decide whether to use agent API)
    pub fn has_custom_params(&self) -> bool {
        self.temperature.is_some()
            || self.max_tokens.is_some()
            || self.top_p.is_some()
            || self.frequency_penalty.is_some()
            || self.presence_penalty.is_some()
            || self.additional_params.is_some()
    }

    /// Builder method for temperature
    pub fn with_temperature(mut self, temp: f64) -> Self {
        self.temperature = Some(temp);
        self
    }

    /// Builder method for max_tokens
    pub fn with_max_tokens(mut self, tokens: i64) -> Self {
        self.max_tokens = Some(tokens);
        self
    }

    /// Builder method for top_p
    pub fn with_top_p(mut self, top_p: f64) -> Self {
        self.top_p = Some(top_p);
        self
    }

    /// Builder method for frequency_penalty
    pub fn with_frequency_penalty(mut self, penalty: f64) -> Self {
        self.frequency_penalty = Some(penalty);
        self
    }

    /// Builder method for presence_penalty
    pub fn with_presence_penalty(mut self, penalty: f64) -> Self {
        self.presence_penalty = Some(penalty);
        self
    }

    /// Builder method for additional_params
    pub fn with_additional_params(mut self, params: serde_json::Value) -> Self {
        self.additional_params = Some(params);
        self
    }
}

