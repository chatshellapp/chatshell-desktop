use serde::{Deserialize, Serialize};

use super::ModelParameters;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assistant {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub description: Option<String>,
    pub system_prompt: String,
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    /// LLM generation parameters (flattened for JSON compatibility)
    #[serde(flatten)]
    pub model_params: ModelParameters,

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

    /// LLM generation parameters (flattened for JSON compatibility)
    #[serde(flatten)]
    pub model_params: Option<ModelParameters>,

    pub avatar_type: Option<String>,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,

    pub group_name: Option<String>,
    pub is_starred: Option<bool>,
}
