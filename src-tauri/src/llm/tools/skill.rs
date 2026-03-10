//! Skill tool for LLM agents.
//!
//! Loads the full instructions for a skill by name. The tool description contains
//! an XML catalog of all available skills so the model can discover them without
//! needing a separate system-prompt section.

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Clone)]
pub struct SkillCatalogEntry {
    pub name: String,
    pub description: Option<String>,
    /// Absolute path to the SKILL.md file
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SkillArgs {
    pub name: String,
}

#[derive(Debug, thiserror::Error)]
#[error("Skill error: {0}")]
pub struct SkillError(String);

#[derive(Clone)]
pub struct SkillTool {
    skills: Vec<SkillCatalogEntry>,
}

impl SkillTool {
    pub fn new(skills: Vec<SkillCatalogEntry>) -> Self {
        Self { skills }
    }
}

impl Tool for SkillTool {
    const NAME: &'static str = "skill";

    type Error = SkillError;
    type Args = SkillArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        let mut desc = String::from(
            "Load the full instructions for a skill by name. \
             Use this when a task matches an available skill.\n\n\
             <available_skills>\n",
        );
        for entry in &self.skills {
            let d = entry.description.as_deref().unwrap_or("No description");
            desc.push_str(&format!(
                "  <skill name=\"{}\" path=\"{}\">{}</skill>\n",
                entry.name, entry.path, d
            ));
        }
        desc.push_str("</available_skills>");

        ToolDefinition {
            name: "skill".to_string(),
            description: desc,
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Skill name from the available_skills catalog"
                    }
                },
                "required": ["name"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!("🔧 [tool-call] skill: name=\"{}\"", args.name);

        let entry = self
            .skills
            .iter()
            .find(|e| e.name == args.name)
            .ok_or_else(|| SkillError(format!("Unknown skill: {}", args.name)))?;

        let path = std::path::Path::new(&entry.path);
        if !path.exists() {
            return Err(SkillError(format!(
                "Skill file not found: {}",
                path.display()
            )));
        }
        if !path.is_file() {
            return Err(SkillError(format!(
                "Skill path is not a file: {}",
                path.display()
            )));
        }

        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| SkillError(format!("Failed to read skill file: {}", e)))?;

        let body = strip_frontmatter(&content);
        let skill_dir = path.parent().unwrap_or(path);
        let dir = skill_dir.to_string_lossy().to_string();

        let resource_files = collect_resource_files(skill_dir).await;

        let path_note = if resource_files.is_empty() {
            format!("Skill directory: {}", dir)
        } else {
            let files_xml: String = resource_files
                .iter()
                .map(|f| format!("  <file>{}</file>", f))
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "Skill directory: {}\nRelative paths in this skill are relative to the skill directory.\n\n<skill_resources>\n{}\n</skill_resources>",
                dir, files_xml
            )
        };

        Ok(format!(
            "<skill_content name=\"{}\">\n{}\n\n{}\n</skill_content>",
            args.name, body, path_note
        ))
    }
}

/// Recursively collect all files in the skill directory except SKILL.md, returning
/// paths relative to that directory. Capped at 20 entries to keep output concise.
async fn collect_resource_files(dir: &std::path::Path) -> Vec<String> {
    const MAX_FILES: usize = 20;
    let mut results = Vec::new();
    collect_recursive(dir, dir, &mut results, MAX_FILES);
    results
}

fn collect_recursive(
    base: &std::path::Path,
    current: &std::path::Path,
    out: &mut Vec<String>,
    limit: usize,
) {
    if out.len() >= limit {
        return;
    }
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut sorted: Vec<_> = entries.flatten().collect();
    sorted.sort_by_key(|e| e.file_name());
    for entry in sorted {
        if out.len() >= limit {
            break;
        }
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        // Skip hidden files/dirs and SKILL.md
        if name.starts_with('.') || name == "SKILL.md" {
            continue;
        }
        if path.is_dir() {
            collect_recursive(base, &path, out, limit);
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(base) {
                out.push(rel.to_string_lossy().to_string());
            }
        }
    }
}

fn strip_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return content;
    }
    let after_opening = &trimmed[3..];
    if let Some(end_pos) = after_opening.find("\n---") {
        let body_start = end_pos + 4;
        after_opening[body_start..].trim_start()
    } else {
        content
    }
}
