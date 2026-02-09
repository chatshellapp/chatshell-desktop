//! Skill Scanner - discovers and parses SKILL.md files from the filesystem.
//!
//! Skills are stored as directories containing a SKILL.md file with optional YAML frontmatter.
//!
//! ## Directory structure:
//! ```
//! skills/
//!   my-skill/
//!     SKILL.md        # Required: contains frontmatter + instructions
//!   another-skill/
//!     SKILL.md
//! ```
//!
//! ## SKILL.md format:
//! ```markdown
//! ---
//! name: My Skill
//! description: What this skill does
//! icon: "🔧"
//! required_tools:
//!   - builtin-web-search
//! ---
//!
//! # Instructions
//!
//! These instructions will be injected into the system prompt...
//! ```

use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::models::CreateSkillRequest;

/// A discovered skill from the filesystem (before DB indexing)
#[derive(Debug, Clone)]
pub struct DiscoveredSkill {
    pub name: String,
    pub description: Option<String>,
    pub source: String,
    pub path: String,
    pub icon: Option<String>,
    pub required_tool_ids: Vec<String>,
    pub allow_model_invocation: bool,
    pub allow_user_invocation: bool,
    pub instructions: String,
    pub content_hash: String,
}

impl DiscoveredSkill {
    /// Convert to a CreateSkillRequest for database upsert
    pub fn to_create_request(&self) -> CreateSkillRequest {
        CreateSkillRequest {
            name: self.name.clone(),
            description: self.description.clone(),
            source: self.source.clone(),
            path: self.path.clone(),
            icon: self.icon.clone(),
            required_tool_ids: Some(self.required_tool_ids.clone()),
            allow_model_invocation: Some(self.allow_model_invocation),
            allow_user_invocation: Some(self.allow_user_invocation),
            content_hash: Some(self.content_hash.clone()),
            cached_instructions: Some(self.instructions.clone()),
            is_enabled: Some(true),
        }
    }
}

/// Frontmatter parsed from SKILL.md YAML header
#[derive(Debug, Clone, Default)]
struct SkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    required_tools: Option<Vec<String>>,
    disable_model_invocation: Option<bool>,
    disable_user_invocation: Option<bool>,
}

/// Scans directories for SKILL.md files and parses them
pub struct SkillScanner {
    builtin_dir: PathBuf,
    user_dir: PathBuf,
}

impl SkillScanner {
    pub fn new(builtin_dir: PathBuf, user_dir: PathBuf) -> Self {
        Self {
            builtin_dir,
            user_dir,
        }
    }

    /// Scan all skill directories and return discovered skills
    pub async fn scan_all(&self) -> Result<Vec<DiscoveredSkill>> {
        let mut skills = Vec::new();

        // Scan builtin skills
        skills.extend(self.scan_directory(&self.builtin_dir, "builtin").await?);

        // Scan user skills
        skills.extend(self.scan_directory(&self.user_dir, "user").await?);

        tracing::info!(
            "📋 [skill_scanner] Discovered {} skill(s) ({} builtin, {} user)",
            skills.len(),
            skills.iter().filter(|s| s.source == "builtin").count(),
            skills.iter().filter(|s| s.source == "user").count(),
        );

        Ok(skills)
    }

    /// Scan a single directory for SKILL.md files
    async fn scan_directory(&self, dir: &Path, source: &str) -> Result<Vec<DiscoveredSkill>> {
        let mut skills = Vec::new();

        if !dir.exists() {
            tracing::debug!(
                "📋 [skill_scanner] Directory does not exist, skipping: {:?}",
                dir
            );
            return Ok(skills);
        }

        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(e) => {
                tracing::warn!(
                    "⚠️ [skill_scanner] Failed to read directory {:?}: {}",
                    dir,
                    e
                );
                return Ok(skills);
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let skill_md = entry.path().join("SKILL.md");
            if skill_md.exists() {
                match self.parse_skill_md(&skill_md, source).await {
                    Ok(skill) => {
                        tracing::debug!(
                            "📋 [skill_scanner] Found skill: {} ({})",
                            skill.name,
                            source
                        );
                        skills.push(skill);
                    }
                    Err(e) => {
                        tracing::warn!("⚠️ [skill_scanner] Failed to parse {:?}: {}", skill_md, e);
                    }
                }
            }
        }

        Ok(skills)
    }

    /// Parse a SKILL.md file with optional YAML frontmatter
    async fn parse_skill_md(&self, path: &Path, source: &str) -> Result<DiscoveredSkill> {
        let content = tokio::fs::read_to_string(path).await?;
        let content_hash = crate::storage::hash_content(&content);
        let (frontmatter, instructions) = parse_frontmatter(&content);

        // Derive name: frontmatter.name > directory name
        let dir_name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        let name = frontmatter.name.unwrap_or_else(|| dir_name.to_string());

        Ok(DiscoveredSkill {
            name,
            description: frontmatter.description,
            source: source.to_string(),
            path: path.parent().unwrap_or(path).to_string_lossy().to_string(),
            icon: frontmatter.icon,
            required_tool_ids: frontmatter.required_tools.unwrap_or_default(),
            allow_model_invocation: !frontmatter.disable_model_invocation.unwrap_or(false),
            allow_user_invocation: !frontmatter.disable_user_invocation.unwrap_or(false),
            instructions,
            content_hash,
        })
    }
}

/// Parse YAML frontmatter from markdown content.
/// Frontmatter is delimited by `---` at the start of the file.
///
/// Returns (frontmatter, body_content)
fn parse_frontmatter(content: &str) -> (SkillFrontmatter, String) {
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        return (SkillFrontmatter::default(), content.to_string());
    }

    // Find the closing ---
    let after_opening = &trimmed[3..];
    if let Some(end_pos) = after_opening.find("\n---") {
        let yaml_str = &after_opening[..end_pos].trim();
        let body_start = end_pos + 4; // skip "\n---"
        let body = after_opening[body_start..].trim().to_string();

        let frontmatter = parse_yaml_frontmatter(yaml_str);
        (frontmatter, body)
    } else {
        // No closing ---, treat entire content as body
        (SkillFrontmatter::default(), content.to_string())
    }
}

/// Simple YAML-like frontmatter parser (avoids pulling in a full YAML crate)
fn parse_yaml_frontmatter(yaml: &str) -> SkillFrontmatter {
    let mut fm = SkillFrontmatter::default();
    let mut current_list_key: Option<String> = None;
    let mut list_items: Vec<String> = Vec::new();

    for line in yaml.lines() {
        let trimmed = line.trim();

        // Check if this is a list item (starts with "- ")
        if let Some(item) = trimmed.strip_prefix("- ") {
            let item = item.trim().trim_matches('"').trim_matches('\'');
            list_items.push(item.to_string());
            continue;
        }

        // Flush any pending list
        if let Some(ref key) = current_list_key {
            if !list_items.is_empty() {
                match key.as_str() {
                    "required_tools" => fm.required_tools = Some(list_items.clone()),
                    _ => {}
                }
                list_items.clear();
            }
            current_list_key = None;
        }

        // Parse key: value
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');

            if value.is_empty() {
                // This could be the start of a list
                current_list_key = Some(key.to_string());
                continue;
            }

            match key {
                "name" => fm.name = Some(value.to_string()),
                "description" => fm.description = Some(value.to_string()),
                "icon" => fm.icon = Some(value.to_string()),
                "disable_model_invocation" => fm.disable_model_invocation = Some(value == "true"),
                "disable_user_invocation" => fm.disable_user_invocation = Some(value == "true"),
                _ => {}
            }
        }
    }

    // Flush any remaining list
    if let Some(ref key) = current_list_key {
        if !list_items.is_empty() {
            match key.as_str() {
                "required_tools" => fm.required_tools = Some(list_items),
                _ => {}
            }
        }
    }

    fm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frontmatter_basic() {
        let content = r#"---
name: Test Skill
description: A test skill
icon: "🧪"
---

# Instructions

Do something useful."#;

        let (fm, body) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("Test Skill".to_string()));
        assert_eq!(fm.description, Some("A test skill".to_string()));
        assert_eq!(fm.icon, Some("🧪".to_string()));
        assert!(body.contains("# Instructions"));
        assert!(body.contains("Do something useful."));
    }

    #[test]
    fn test_parse_frontmatter_with_list() {
        let content = r#"---
name: Search Expert
required_tools:
  - builtin-web-search
  - builtin-web-fetch
---

Search the web for information."#;

        let (fm, body) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("Search Expert".to_string()));
        assert_eq!(
            fm.required_tools,
            Some(vec![
                "builtin-web-search".to_string(),
                "builtin-web-fetch".to_string()
            ])
        );
        assert!(body.contains("Search the web"));
    }

    #[test]
    fn test_parse_frontmatter_no_frontmatter() {
        let content = "# Just a regular markdown file\n\nWith content.";
        let (fm, body) = parse_frontmatter(content);
        assert!(fm.name.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn test_parse_frontmatter_invocation_flags() {
        let content = r#"---
name: Auto Only
disable_user_invocation: true
---

Instructions here."#;

        let (fm, _body) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("Auto Only".to_string()));
        assert_eq!(fm.disable_user_invocation, Some(true));
        assert!(fm.disable_model_invocation.is_none());
    }
}
