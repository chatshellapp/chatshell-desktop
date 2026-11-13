use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use crate::skills::SkillFile;

/// A Skill bundles prompt instructions with optional required tools.
/// Skills are directories with a SKILL.md on the filesystem, indexed in the
/// database. ChatShell's own skills (`user`) and builtin skills sync; skills
/// found in other agents' directories stay on the device that found them.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Skill {
    pub id: String,
    pub name: String,
    #[ts(optional)]
    pub description: Option<String>,
    /// "builtin" | "user" | an external source ("claude", "agents", ...)
    pub source: String,
    /// Directory name relative to the source root (device-independent)
    pub path: String,
    /// Absolute directory on this device when the skill's files are present
    /// here (not stored; filled per device). `None` means the skill is known
    /// but not materialized yet, e.g. a synced skill still being fetched.
    #[serde(default)]
    #[ts(optional)]
    pub local_path: Option<String>,
    /// Files of the skill directory (ChatShell's own skills only; they
    /// travel between devices as blobs)
    #[serde(default)]
    pub files_manifest: Vec<SkillFile>,
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
    /// Blake3 hash over the skill's file manifest (every file, not only
    /// SKILL.md) for change detection
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

impl Skill {
    /// Whether the skill goes into the model's skill catalog: it must be
    /// enabled, and its SKILL.md must not opt out with
    /// `disable_model_invocation: true`. Its required tools are only
    /// auto-enabled when it is offered.
    pub fn offered_to_model(&self) -> bool {
        self.is_enabled && self.allow_model_invocation
    }
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
    #[serde(default)]
    #[ts(optional)]
    pub files_manifest: Option<Vec<SkillFile>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(is_enabled: bool, allow_model_invocation: bool) -> Skill {
        Skill {
            id: "s".into(),
            name: "s".into(),
            description: None,
            source: "user".into(),
            path: "s".into(),
            local_path: None,
            files_manifest: Vec::new(),
            icon: None,
            required_tool_ids: Vec::new(),
            allow_model_invocation,
            allow_user_invocation: true,
            content_hash: None,
            cached_instructions: None,
            is_enabled,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn only_enabled_skills_that_allow_the_model_are_offered() {
        assert!(skill(true, true).offered_to_model());
        assert!(!skill(false, true).offered_to_model());
        assert!(
            !skill(true, false).offered_to_model(),
            "disable_model_invocation opts out"
        );
        assert!(!skill(false, false).offered_to_model());
    }
}
