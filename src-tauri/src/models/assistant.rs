use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::ModelParameterPreset;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Assistant {
    pub id: String,
    pub name: String,
    #[ts(optional)]
    pub role: Option<String>,
    #[ts(optional)]
    pub description: Option<String>,
    pub system_prompt: String,
    #[ts(optional)]
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    /// Reference to parameter preset
    #[ts(optional)]
    pub model_parameter_preset_id: Option<String>,

    /// The full preset data (populated via JOIN, not stored directly)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub preset: Option<ModelParameterPreset>,

    /// Tool IDs associated with this assistant (builtin tools + MCP servers)
    /// Populated from assistant_tools junction table
    #[serde(default)]
    pub tool_ids: Vec<String>,

    /// Skill IDs associated with this assistant
    /// Populated from assistant_skills junction table
    #[serde(default)]
    pub skill_ids: Vec<String>,

    // Avatar fields
    pub avatar_type: String,
    #[ts(optional)]
    pub avatar_bg: Option<String>,
    #[ts(optional)]
    pub avatar_text: Option<String>,
    #[ts(optional)]
    pub avatar_image_path: Option<String>,
    #[ts(optional)]
    pub avatar_image_url: Option<String>,

    #[ts(optional)]
    pub group_name: Option<String>,
    pub is_starred: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateAssistantRequest {
    pub name: String,
    #[ts(optional)]
    pub role: Option<String>,
    #[ts(optional)]
    pub description: Option<String>,
    pub system_prompt: String,
    #[ts(optional)]
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    /// Reference to parameter preset (optional - will use default if not specified)
    #[ts(optional)]
    pub model_parameter_preset_id: Option<String>,

    /// Tool IDs to associate (builtin tools + MCP servers)
    #[ts(optional)]
    pub tool_ids: Option<Vec<String>>,

    /// Skill IDs to associate
    #[ts(optional)]
    pub skill_ids: Option<Vec<String>>,

    #[ts(optional)]
    pub avatar_type: Option<String>,
    #[ts(optional)]
    pub avatar_bg: Option<String>,
    #[ts(optional)]
    pub avatar_text: Option<String>,
    #[ts(optional)]
    pub avatar_image_path: Option<String>,
    #[ts(optional)]
    pub avatar_image_url: Option<String>,

    #[ts(optional)]
    pub group_name: Option<String>,
    #[ts(optional)]
    pub is_starred: Option<bool>,
}
