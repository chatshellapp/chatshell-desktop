use serde::{Deserialize, Serialize};

use super::conversation_settings::deserialize_double_option;
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

/// Partial update. For the clearable fields an absent key keeps the stored
/// value, `null` clears it (the provider default applies) and a value sets it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateModelParameterPresetRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    /// Absent keeps, null clears, value sets
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_double_option"
    )]
    #[ts(optional)]
    pub description: Option<Option<String>>,
    /// Absent keeps, null clears, value sets
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_double_option"
    )]
    #[ts(optional)]
    pub temperature: Option<Option<f64>>,
    /// Absent keeps, null clears, value sets
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_double_option"
    )]
    #[ts(optional)]
    pub max_tokens: Option<Option<i64>>,
    /// Absent keeps, null clears, value sets
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_double_option"
    )]
    #[ts(optional)]
    pub top_p: Option<Option<f64>>,
    /// Absent keeps, null clears, value sets
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_double_option"
    )]
    #[ts(optional)]
    pub frequency_penalty: Option<Option<f64>>,
    /// Absent keeps, null clears, value sets
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_double_option"
    )]
    #[ts(optional)]
    pub presence_penalty: Option<Option<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "unknown")]
    pub additional_params: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_default: Option<bool>,
}

impl From<&ModelParameterPreset> for super::ModelParameters {
    fn from(preset: &ModelParameterPreset) -> Self {
        Self {
            temperature: preset.temperature,
            max_tokens: preset.max_tokens,
            top_p: preset.top_p,
            frequency_penalty: preset.frequency_penalty,
            presence_penalty: preset.presence_penalty,
            additional_params: preset.additional_params.clone(),
        }
    }
}
