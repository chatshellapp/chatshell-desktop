use serde::{Deserialize, Serialize};

/// A Skill bundles prompt instructions with optional required tools.
/// Skills are stored as SKILL.md files on the filesystem, with metadata indexed in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// "builtin" | "user"
    pub source: String,
    /// Filesystem path to the skill directory
    pub path: String,
    /// Emoji or icon identifier
    pub icon: Option<String>,
    /// JSON-encoded array of required tool IDs
    #[serde(default)]
    pub required_tool_ids: Vec<String>,
    /// Whether the LLM can auto-invoke this skill
    pub allow_model_invocation: bool,
    /// Whether the user can manually invoke this skill
    pub allow_user_invocation: bool,
    /// Blake3 hash of SKILL.md content for change detection
    pub content_hash: Option<String>,
    /// Cached parsed instructions from SKILL.md
    pub cached_instructions: Option<String>,
    /// Whether the skill is globally enabled
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Request to create or update a skill in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSkillRequest {
    pub name: String,
    pub description: Option<String>,
    pub source: String,
    pub path: String,
    pub icon: Option<String>,
    pub required_tool_ids: Option<Vec<String>>,
    pub allow_model_invocation: Option<bool>,
    pub allow_user_invocation: Option<bool>,
    pub content_hash: Option<String>,
    pub cached_instructions: Option<String>,
    pub is_enabled: Option<bool>,
}
