//! Skill Scanner - discovers and parses SKILL.md files from the filesystem.
//!
//! Skills are stored as directories containing a SKILL.md file with optional YAML frontmatter.
//!
//! ## Directory structure:
//! ```text
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

/// A directory to scan for skills, with its source label
#[derive(Debug, Clone)]
pub struct ScanDirectory {
    pub path: PathBuf,
    pub source: String,
}

/// Scans directories for SKILL.md files and parses them
pub struct SkillScanner {
    directories: Vec<ScanDirectory>,
}

impl SkillScanner {
    pub fn new(directories: Vec<ScanDirectory>) -> Self {
        Self { directories }
    }

    /// Scan all skill directories and return discovered skills
    pub async fn scan_all(&self) -> Result<Vec<DiscoveredSkill>> {
        let mut skills = Vec::new();

        for dir in &self.directories {
            skills.extend(self.scan_directory(&dir.path, &dir.source).await?);
        }

        let sources: Vec<String> = self.directories.iter().map(|d| d.source.clone()).collect();
        let source_counts: Vec<String> = sources
            .iter()
            .map(|s| {
                format!(
                    "{} {}",
                    skills.iter().filter(|sk| sk.source == *s).count(),
                    s
                )
            })
            .collect();

        tracing::info!(
            "📋 [skill_scanner] Discovered {} skill(s) ({})",
            skills.len(),
            source_counts.join(", "),
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
                if key.as_str() == "required_tools" {
                    fm.required_tools = Some(list_items.clone())
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
    if let Some(ref key) = current_list_key
        && !list_items.is_empty()
        && key.as_str() == "required_tools"
    {
        fm.required_tools = Some(list_items)
    }

    fm
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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

    fn write_file(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn scan_entry(path: std::path::PathBuf, source: &str) -> ScanDirectory {
        ScanDirectory {
            path,
            source: source.to_string(),
        }
    }

    #[test]
    fn parse_frontmatter_unclosed_delimiter_treated_as_body() {
        let content = "---\nname: Ghost\nnever closed";
        let (fm, body) = parse_frontmatter(content);
        assert_eq!(fm.name, None);
        assert_eq!(body, content);
    }

    #[test]
    fn parse_frontmatter_empty_block_and_empty_content() {
        let (fm, body) = parse_frontmatter("---\n---\nbody text");
        assert_eq!(fm.name, None);
        assert_eq!(body, "body text");

        let (fm, body) = parse_frontmatter("");
        assert_eq!(fm.name, None);
        assert_eq!(body, "");

        let (fm, body) = parse_frontmatter("   \n\t\n");
        assert_eq!(fm.name, None);
        assert_eq!(body, "   \n\t\n");
    }

    #[test]
    fn parse_frontmatter_tolerates_leading_whitespace() {
        let content = "\n\n  ---\nname: Indented\n---\n\nbody";
        let (fm, body) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("Indented".to_string()));
        assert_eq!(body, "body");
    }

    #[test]
    fn parse_yaml_quoted_values_and_flags() {
        let yaml = "\
name: 'Single Quoted'
description: \"Double Quoted\"
icon: \"🧩\"
unknown_key: ignored
a line without colon
disable_model_invocation: false
disable_user_invocation: true
";
        let fm = parse_yaml_frontmatter(yaml);
        assert_eq!(fm.name, Some("Single Quoted".to_string()));
        assert_eq!(fm.description, Some("Double Quoted".to_string()));
        assert_eq!(fm.icon, Some("🧩".to_string()));
        assert_eq!(fm.disable_model_invocation, Some(false));
        assert_eq!(fm.disable_user_invocation, Some(true));
        assert!(fm.required_tools.is_none());
    }

    #[test]
    fn parse_yaml_flushes_list_when_next_key_appears() {
        let yaml = "\
required_tools:
  - tool-a
  - \"tool-b\"
name: After List
";
        let fm = parse_yaml_frontmatter(yaml);
        assert_eq!(
            fm.required_tools,
            Some(vec!["tool-a".to_string(), "tool-b".to_string()])
        );
        assert_eq!(fm.name, Some("After List".to_string()));
    }

    #[test]
    fn parse_yaml_ignores_empty_and_foreign_list_keys() {
        let yaml = "\
description:
name: Kept
tags:
  - a
  - b
";
        let fm = parse_yaml_frontmatter(yaml);
        assert_eq!(fm.name, Some("Kept".to_string()));
        assert_eq!(fm.description, None, "empty value without items is no list");
        assert!(
            fm.required_tools.is_none(),
            "lists under other keys must be dropped"
        );
    }

    #[test]
    fn to_create_request_maps_every_field() {
        let skill = DiscoveredSkill {
            name: "n".to_string(),
            description: Some("d".to_string()),
            source: "s".to_string(),
            path: "/p".to_string(),
            icon: Some("🔧".to_string()),
            required_tool_ids: vec!["t1".to_string()],
            allow_model_invocation: false,
            allow_user_invocation: true,
            instructions: "i".to_string(),
            content_hash: "h".to_string(),
        };
        let req = skill.to_create_request();
        assert_eq!(req.name, "n");
        assert_eq!(req.description, Some("d".to_string()));
        assert_eq!(req.source, "s");
        assert_eq!(req.path, "/p");
        assert_eq!(req.icon, Some("🔧".to_string()));
        assert_eq!(req.required_tool_ids, Some(vec!["t1".to_string()]));
        assert_eq!(req.allow_model_invocation, Some(false));
        assert_eq!(req.allow_user_invocation, Some(true));
        assert_eq!(req.content_hash, Some("h".to_string()));
        assert_eq!(req.cached_instructions, Some("i".to_string()));
        assert_eq!(req.is_enabled, Some(true));
    }

    #[tokio::test]
    async fn scan_all_discovers_and_maps_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let dir_a = tmp.path().join("bundled");
        let dir_b = tmp.path().join("user");

        let alpha_md = "---\nname: Alpha Skill\ndescription: Does alpha things\nicon: \"🧩\"\nrequired_tools:\n  - \"builtin-web-search\"\n  - builtin-code-exec\ndisable_model_invocation: true\n---\n\nDo the alpha dance.\n";
        write_file(&dir_a.join("alpha").join("SKILL.md"), alpha_md.as_bytes());
        // Decoys that must NOT be discovered: a loose non-skill file, an
        // empty directory, and a skill nested one level too deep (the
        // scanner does not recurse).
        write_file(&dir_a.join("README.md"), b"not a skill");
        fs::create_dir_all(dir_a.join("empty")).unwrap();
        write_file(
            &dir_a.join("outer").join("inner").join("SKILL.md"),
            b"# too deep",
        );

        let beta_md = "# Just instructions\n\nPlain body without frontmatter.\n";
        write_file(&dir_b.join("beta").join("SKILL.md"), beta_md.as_bytes());

        let scanner = SkillScanner::new(vec![
            scan_entry(dir_a.clone(), "bundled"),
            scan_entry(dir_b.clone(), "user"),
        ]);
        let skills = scanner.scan_all().await.unwrap();
        assert_eq!(skills.len(), 2, "{skills:?}");

        let alpha = skills.iter().find(|s| s.source == "bundled").unwrap();
        assert_eq!(alpha.name, "Alpha Skill");
        assert_eq!(alpha.description, Some("Does alpha things".to_string()));
        assert_eq!(alpha.icon, Some("🧩".to_string()));
        assert_eq!(
            alpha.required_tool_ids,
            vec![
                "builtin-web-search".to_string(),
                "builtin-code-exec".to_string()
            ]
        );
        assert!(!alpha.allow_model_invocation);
        assert!(alpha.allow_user_invocation);
        assert_eq!(alpha.instructions, "Do the alpha dance.");
        assert_eq!(alpha.path, dir_a.join("alpha").to_string_lossy());
        assert_eq!(alpha.content_hash, crate::storage::hash_content(alpha_md));

        let beta = skills.iter().find(|s| s.source == "user").unwrap();
        assert_eq!(beta.name, "beta", "name falls back to the directory name");
        assert_eq!(beta.description, None);
        assert!(beta.required_tool_ids.is_empty());
        assert!(beta.allow_model_invocation);
        assert!(beta.allow_user_invocation);
        assert_eq!(beta.instructions, beta_md);
        assert_eq!(beta.path, dir_b.join("beta").to_string_lossy());
        assert_eq!(beta.content_hash, crate::storage::hash_content(beta_md));
    }

    #[tokio::test]
    async fn scan_all_skips_missing_and_unreadable_directories() {
        let tmp = tempfile::tempdir().unwrap();
        let valid = tmp.path().join("valid");
        write_file(&valid.join("solo").join("SKILL.md"), b"# hi");
        // A file where a directory is expected: read_dir fails (ENOTDIR)
        // deterministically on every platform and permission setup.
        let not_a_dir = tmp.path().join("not-a-dir");
        write_file(&not_a_dir, b"plain file");

        let broken = SkillScanner::new(vec![
            scan_entry(tmp.path().join("does-not-exist"), "missing"),
            scan_entry(not_a_dir.clone(), "unreadable"),
        ]);
        assert!(broken.scan_all().await.unwrap().is_empty());

        // Broken targets never mask healthy ones.
        let mixed = SkillScanner::new(vec![
            scan_entry(tmp.path().join("does-not-exist"), "missing"),
            scan_entry(not_a_dir, "unreadable"),
            scan_entry(valid.clone(), "valid"),
        ]);
        let skills = mixed.scan_all().await.unwrap();
        assert_eq!(skills.len(), 1, "{skills:?}");
        assert_eq!(skills[0].name, "solo");
        assert_eq!(skills[0].source, "valid");
    }

    #[tokio::test]
    async fn scan_all_skips_non_utf8_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("skills");
        write_file(
            &dir.join("broken").join("SKILL.md"),
            &[0xff, 0xfe, 0x00, 0x80],
        );
        write_file(&dir.join("healthy").join("SKILL.md"), b"# fine");

        let scanner = SkillScanner::new(vec![scan_entry(dir, "src")]);
        let skills = scanner.scan_all().await.unwrap();
        assert_eq!(skills.len(), 1, "{skills:?}");
        assert_eq!(skills[0].name, "healthy");
    }

    #[tokio::test]
    async fn same_named_skills_in_two_sources_are_both_reported() {
        let tmp = tempfile::tempdir().unwrap();
        let dir_a = tmp.path().join("a");
        let dir_b = tmp.path().join("b");
        write_file(
            &dir_a.join("my-skill").join("SKILL.md"),
            b"---\nname: Shared\n---\nfrom A",
        );
        write_file(
            &dir_b.join("my-skill").join("SKILL.md"),
            b"# no frontmatter, from B",
        );

        let scanner = SkillScanner::new(vec![
            scan_entry(dir_a, "first"),
            scan_entry(dir_b, "second"),
        ]);
        let skills = scanner.scan_all().await.unwrap();
        // Both are reported (dedup is the indexer's job via upsert); the
        // concatenation follows the configured directory order.
        assert_eq!(skills.len(), 2, "{skills:?}");
        assert_eq!(skills[0].source, "first");
        assert_eq!(skills[0].name, "Shared");
        assert_eq!(skills[1].source, "second");
        assert_eq!(skills[1].name, "my-skill");
    }
}
