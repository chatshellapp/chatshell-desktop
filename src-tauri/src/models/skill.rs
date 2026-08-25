use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A Skill bundles prompt instructions with optional required tools.
/// Skills are stored as SKILL.md files on the filesystem, with metadata indexed in the database.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Skill {
    pub id: String,
    pub name: String,
    #[ts(optional)]
    pub description: Option<String>,
    /// "builtin" | "user"
    pub source: String,
    /// Filesystem path to the skill directory
    pub path: String,
    /// Emoji or icon identifier
    #[ts(optional)]
    pub icon: Option<String>,
    /// JSON-encoded array of required tool IDs
    #[serde(default)]
    pub required_tool_ids: Vec<String>,
    /// Whether the LLM can auto-invoke this skill
    pub allow_model_invocation: bool,
    /// Whether the user can manually invoke this skill
    pub allow_user_invocation: bool,
    /// Blake3 hash of SKILL.md content for change detection
    #[ts(optional)]
    pub content_hash: Option<String>,
    /// Cached parsed instructions from SKILL.md
    #[ts(optional)]
    pub cached_instructions: Option<String>,
    /// Whether the skill is globally enabled
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Request to create or update a skill in the database
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateSkillRequest {
    pub name: String,
    #[ts(optional)]
    pub description: Option<String>,
    pub source: String,
    pub path: String,
    #[ts(optional)]
    pub icon: Option<String>,
    #[ts(optional)]
    pub required_tool_ids: Option<Vec<String>>,
    #[ts(optional)]
    pub allow_model_invocation: Option<bool>,
    #[ts(optional)]
    pub allow_user_invocation: Option<bool>,
    #[ts(optional)]
    pub content_hash: Option<String>,
    #[ts(optional)]
    pub cached_instructions: Option<String>,
    #[ts(optional)]
    pub is_enabled: Option<bool>,
}
