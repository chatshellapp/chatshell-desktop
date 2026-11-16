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

use super::manifest::{SkillFile, build_manifest, is_safe_dir_name, manifest_hash};
use crate::models::CreateSkillRequest;

/// A discovered skill from the filesystem (before DB indexing)
#[derive(Debug, Clone)]
pub struct DiscoveredSkill {
    /// Stable id declared in frontmatter (`metadata.id`; the flat parser
    /// also accepts a top-level `id`). Honoured for builtin
    /// skills only, so every device indexes a bundled skill under the same
    /// row and assistant links to it survive sync.
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub source: String,
    /// Directory name relative to the source root (see `SkillRoots`).
    pub path: String,
    /// Absolute directory on this device.
    pub dir: PathBuf,
    /// Every file of the skill directory.
    pub files: Vec<SkillFile>,
    pub icon: Option<String>,
    pub required_tool_ids: Vec<String>,
    pub allow_model_invocation: bool,
    pub allow_user_invocation: bool,
    pub instructions: String,
    /// Manifest hash: covers every file, not just SKILL.md.
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
            // Only ChatShell's own skills ship their files to peers.
            files_manifest: (self.source == super::roots::SOURCE_USER).then(|| self.files.clone()),
        }
    }
}

/// Frontmatter parsed from SKILL.md YAML header
#[derive(Debug, Clone, Default)]
struct SkillFrontmatter {
    id: Option<String>,
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

            let dir_name = entry.file_name();
            let Some(dir_name) = dir_name.to_str() else {
                continue;
            };
            // Dot-entries (ChatShell's `.trash`, editor/VCS state) and names
            // that cannot round-trip as a relative path are never skills.
            if !is_safe_dir_name(dir_name) {
                continue;
            }
            let skill_md = entry.path().join("SKILL.md");
            if skill_md.is_file() {
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
        let (frontmatter, instructions) = parse_frontmatter(&content);
        let dir = path.parent().unwrap_or(path).to_path_buf();
        let files = {
            let dir = dir.clone();
            tokio::task::spawn_blocking(move || build_manifest(&dir)).await??
        };
        let content_hash = manifest_hash(&files);

        // Derive name: frontmatter.name > directory name
        let dir_name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        let name = frontmatter.name.unwrap_or_else(|| dir_name.to_string());

        let id = frontmatter
            .id
            .filter(|_| source == super::roots::SOURCE_BUILTIN)
            .filter(|id| uuid::Uuid::parse_str(id).is_ok());

        Ok(DiscoveredSkill {
            id,
            name,
            description: frontmatter.description,
            source: source.to_string(),
            path: dir_name.to_string(),
            dir,
            files,
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
    let lines: Vec<&str> = yaml.lines().collect();
    let mut current_list_key: Option<String> = None;
    let mut list_items: Vec<String> = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        let indent = indent_of(line);
        i += 1;

        // List item under the pending list key
        if let Some(item) = trimmed.strip_prefix("- ") {
            list_items.push(unquote(item.trim()).to_string());
            continue;
        }

        // Flush any pending list
        if let Some(key) = current_list_key.take()
            && !list_items.is_empty()
        {
            if key == "required_tools" {
                fm.required_tools = Some(list_items.clone());
            }
            list_items.clear();
        }

        let Some((key, raw)) = split_key(trimmed) else {
            continue;
        };
        let raw = raw.trim();

        let value = if let Some(style) = BlockStyle::parse(raw) {
            // `key: |` / `key: >` (with optional chomping/indent indicators):
            // the value is every following line indented deeper than the key.
            let mut block = Vec::new();
            while i < lines.len() && (lines[i].trim().is_empty() || indent_of(lines[i]) > indent) {
                block.push(lines[i]);
                i += 1;
            }
            style.render(&block)
        } else if raw.is_empty() {
            // Start of a list or of a nested mapping (e.g. `metadata:`;
            // nested keys are read flat on the following lines).
            current_list_key = Some(key.to_string());
            continue;
        } else {
            // Plain or quoted scalar, possibly continued on deeper-indented
            // lines that are not keys themselves (YAML line folding).
            let mut value = raw.to_string();
            while i < lines.len()
                && indent_of(lines[i]) > indent
                && !lines[i].trim().is_empty()
                && split_key(lines[i].trim()).is_none()
                && !lines[i].trim().starts_with("- ")
            {
                value.push(' ');
                value.push_str(lines[i].trim());
                i += 1;
            }
            unquote(&value).to_string()
        };

        match key {
            "id" => fm.id = Some(value),
            "name" => fm.name = Some(value),
            "description" => fm.description = Some(value),
            "icon" => fm.icon = Some(value),
            "disable_model_invocation" => fm.disable_model_invocation = Some(value == "true"),
            "disable_user_invocation" => fm.disable_user_invocation = Some(value == "true"),
            _ => {}
        }
    }

    // Flush any remaining list
    if let Some(key) = current_list_key
        && !list_items.is_empty()
        && key == "required_tools"
    {
        fm.required_tools = Some(list_items)
    }

    fm
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// `key: value` where the key is a plain identifier. Prose such as
/// "Triggers on: x" inside a folded value is not a key.
fn split_key(trimmed: &str) -> Option<(&str, &str)> {
    let (key, value) = trimmed.split_once(':')?;
    let key = key.trim();
    let is_ident = !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    // `key:value` without a space is a scalar (e.g. a URL), not a mapping.
    let separated = value.is_empty() || value.starts_with([' ', '\t']);
    (is_ident && separated).then_some((key, value))
}

fn unquote(value: &str) -> &str {
    let v = value.trim();
    for q in ['"', '\''] {
        if v.len() >= 2 && v.starts_with(q) && v.ends_with(q) {
            return &v[1..v.len() - 1];
        }
    }
    v
}

/// YAML block scalar header: `|` (literal) or `>` (folded), optionally
/// followed by a chomping (`-`/`+`) and/or indentation indicator.
struct BlockStyle {
    folded: bool,
    keep_trailing: bool,
}

impl BlockStyle {
    fn parse(raw: &str) -> Option<Self> {
        let mut chars = raw.chars();
        let folded = match chars.next()? {
            '|' => false,
            '>' => true,
            _ => return None,
        };
        let rest: String = chars.collect();
        if !rest
            .chars()
            .all(|c| c == '-' || c == '+' || c.is_ascii_digit())
        {
            return None;
        }
        Some(Self {
            folded,
            keep_trailing: rest.contains('+'),
        })
    }

    fn render(&self, block: &[&str]) -> String {
        let base = block
            .iter()
            .filter(|l| !l.trim().is_empty())
            .map(|l| indent_of(l))
            .min()
            .unwrap_or(0);
        let body: Vec<&str> = block
            .iter()
            .map(|l| {
                if l.len() >= base {
                    &l[base..]
                } else {
                    l.trim_start()
                }
            })
            .collect();
        let text = if self.folded {
            // Lines fold into spaces; blank lines become paragraph breaks.
            let mut out = String::new();
            for line in &body {
                if line.trim().is_empty() {
                    out.push('\n');
                } else {
                    if !out.is_empty() && !out.ends_with('\n') {
                        out.push(' ');
                    }
                    out.push_str(line.trim_end());
                }
            }
            out
        } else {
            body.join("\n")
        };
        if self.keep_trailing {
            text
        } else {
            text.trim_end().to_string()
        }
    }
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

    /// The installer only works through the terminal; declaring it keeps
    /// devices without one (iOS) from offering the skill.
    #[test]
    fn test_skill_installer_requires_bash() {
        let content = include_str!("../../builtin-skills/skill-installer/SKILL.md");
        let (fm, _) = parse_frontmatter(content);
        assert_eq!(fm.required_tools, Some(vec!["builtin-bash".to_string()]));
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
    fn parse_yaml_block_scalars() {
        let yaml = "\
name: billing
description: |
  Analyze AWS costs, find savings.
  Triggers on: AWS bill, pricing.
metadata:
  version: \"1\"
";
        let fm = parse_yaml_frontmatter(yaml);
        assert_eq!(
            fm.description.as_deref(),
            Some("Analyze AWS costs, find savings.\nTriggers on: AWS bill, pricing.")
        );
        assert_eq!(fm.name.as_deref(), Some("billing"));

        let folded = parse_yaml_frontmatter("description: >-\n  one\n  two\n\n  three\nname: n\n");
        assert_eq!(folded.description.as_deref(), Some("one two\nthree"));
        assert_eq!(folded.name.as_deref(), Some("n"));
    }

    #[test]
    fn parse_yaml_folds_plain_continuation_lines() {
        let yaml = "\
description: Provisions EC2 workloads
  and Auto Scaling groups. Triggers on: ASG.
icon: x
";
        let fm = parse_yaml_frontmatter(yaml);
        assert_eq!(
            fm.description.as_deref(),
            Some("Provisions EC2 workloads and Auto Scaling groups. Triggers on: ASG.")
        );
        assert_eq!(fm.icon.as_deref(), Some("x"));
    }

    #[test]
    fn parse_yaml_reads_nested_metadata_id_flat() {
        let fm = parse_yaml_frontmatter("name: a\nmetadata:\n  id: 019a\n  author: me\n");
        assert_eq!(fm.id.as_deref(), Some("019a"));
        assert_eq!(fm.name.as_deref(), Some("a"));
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
        let file = SkillFile {
            path: "SKILL.md".to_string(),
            hash: "fh".to_string(),
            size: 1,
            executable: false,
        };
        let skill = DiscoveredSkill {
            id: None,
            name: "n".to_string(),
            description: Some("d".to_string()),
            source: "s".to_string(),
            path: "p".to_string(),
            dir: PathBuf::from("/root/p"),
            files: vec![file.clone()],
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
        assert_eq!(req.path, "p");
        assert_eq!(req.icon, Some("🔧".to_string()));
        assert_eq!(req.required_tool_ids, Some(vec!["t1".to_string()]));
        assert_eq!(req.allow_model_invocation, Some(false));
        assert_eq!(req.allow_user_invocation, Some(true));
        assert_eq!(req.content_hash, Some("h".to_string()));
        assert_eq!(req.cached_instructions, Some("i".to_string()));
        assert_eq!(req.is_enabled, Some(true));
        assert_eq!(req.files_manifest, None, "only user skills ship files");
        let user = DiscoveredSkill {
            source: "user".to_string(),
            ..skill
        };
        assert_eq!(user.to_create_request().files_manifest, Some(vec![file]));
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
        assert_eq!(alpha.path, "alpha");
        assert_eq!(alpha.dir, dir_a.join("alpha"));
        assert_eq!(alpha.files.len(), 1);
        assert_eq!(alpha.content_hash, manifest_hash(&alpha.files));

        let beta = skills.iter().find(|s| s.source == "user").unwrap();
        assert_eq!(beta.name, "beta", "name falls back to the directory name");
        assert_eq!(beta.description, None);
        assert!(beta.required_tool_ids.is_empty());
        assert!(beta.allow_model_invocation);
        assert!(beta.allow_user_invocation);
        assert_eq!(beta.instructions, beta_md);
        assert_eq!(beta.path, "beta");
        assert_eq!(
            beta.files[0].hash,
            crate::storage::hash_bytes(beta_md.as_bytes())
        );
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
