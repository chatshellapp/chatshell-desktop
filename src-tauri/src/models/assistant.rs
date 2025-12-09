use serde::{Deserialize, Serialize};

use super::ModelParameterPreset;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assistant {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub description: Option<String>,
    pub system_prompt: String,
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    /// Reference to parameter preset
    pub model_parameter_preset_id: Option<String>,

    /// The full preset data (populated via JOIN, not stored directly)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<ModelParameterPreset>,

    // Avatar fields
    pub avatar_type: String,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,

    pub group_name: Option<String>,
    pub is_starred: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAssistantRequest {
    pub name: String,
    pub role: Option<String>,
    pub description: Option<String>,
    pub system_prompt: String,
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    /// Reference to parameter preset (optional - will use default if not specified)
    pub model_parameter_preset_id: Option<String>,

    pub avatar_type: Option<String>,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,

    pub group_name: Option<String>,
    pub is_starred: Option<bool>,
}
