//! Load skill tool for LLM agents.
//!
//! Loads the full instructions for a skill by name. Used when skills are in the
//! catalog so the LLM can fetch SKILL.md content without using the general read tool.

use std::collections::HashMap;

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Clone, Deserialize)]
pub struct LoadSkillArgs {
    /// Name of the skill (as listed in the Available Skills catalog)
    pub name: String,
}

#[derive(Debug, thiserror::Error)]
#[error("Load skill error: {0}")]
pub struct LoadSkillError(String);

#[derive(Clone)]
pub struct LoadSkillTool {
    /// Maps skill name -> absolute path to SKILL.md
    skills: HashMap<String, String>,
}

impl LoadSkillTool {
    pub fn new(skills: HashMap<String, String>) -> Self {
        Self { skills }
    }
}

impl Tool for LoadSkillTool {
    const NAME: &'static str = "load_skill";

    type Error = LoadSkillError;
    type Args = LoadSkillArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "load_skill".to_string(),
            description: "Load the full instructions for a skill by name. \
                Use this when a task matches an available skill."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the skill (as listed in the Available Skills catalog)"
                    }
                },
                "required": ["name"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!("🔧 [tool-call] load_skill: name=\"{}\"", args.name);

        let path = self
            .skills
            .get(&args.name)
            .ok_or_else(|| LoadSkillError(format!("Unknown skill: {}", args.name)))?;

        let path = std::path::Path::new(path);
        if !path.exists() {
            return Err(LoadSkillError(format!(
                "Skill file not found: {}",
                path.display()
            )));
        }
        if !path.is_file() {
            return Err(LoadSkillError(format!(
                "Skill path is not a file: {}",
                path.display()
            )));
        }

        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| LoadSkillError(format!("Failed to read skill file: {}", e)))?;

        Ok(content)
    }
}
