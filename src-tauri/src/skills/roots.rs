//! Where each skill source lives on this device.
//!
//! The `skills.path` column holds the skill's directory name relative to its
//! source root, never an absolute path: home directories and app bundle
//! locations differ between devices, and `user`/`builtin` rows sync.

use std::path::{Path, PathBuf};
use tauri::Manager;

/// ChatShell's own skills.
pub const SOURCE_USER: &str = "user";
/// Skills bundled with the app.
pub const SOURCE_BUILTIN: &str = "builtin";

/// Well-known skill directories of other agents (beyond ChatShell's own):
/// `(source, path relative to home, settings key of the enable toggle)`.
/// Their skills are indexed on this device only and never synced.
pub const EXTERNAL_SKILL_SOURCES: &[(&str, &str, &str)] = &[
    ("claude", ".claude/skills", "skill_source_claude_enabled"),
    ("agents", ".agents/skills", "skill_source_agents_enabled"),
];

/// Whether rows of `source` sync between devices (mirrors core's
/// `SYNCED_SKILL_SOURCES`, which enforces it in the merge).
pub fn is_synced_source(source: &str) -> bool {
    chatshell_agent_core::sync::SYNCED_SKILL_SOURCES.contains(&source)
}

#[derive(Debug, Clone)]
pub struct SkillRoots {
    pub builtin: PathBuf,
    pub user: PathBuf,
    /// `(source, root)` for every known external source, enabled or not.
    pub external: Vec<(String, PathBuf)>,
}

impl SkillRoots {
    pub fn from_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Self, String> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        let builtin = app
            .path()
            .resource_dir()
            .map(|d| d.join("builtin-skills"))
            .unwrap_or_else(|_| app_data_dir.join("builtin-skills"));
        let home = dirs::home_dir().filter(|h| !h.as_os_str().is_empty());
        Ok(Self::new(builtin, home.as_deref(), &app_data_dir))
    }

    pub fn new(builtin: PathBuf, home: Option<&Path>, app_data_dir: &Path) -> Self {
        let user = match home {
            Some(home) => home.join(".chatshell/skills"),
            None => app_data_dir.join("skills"),
        };
        let external = match home {
            Some(home) => EXTERNAL_SKILL_SOURCES
                .iter()
                .map(|(source, rel, _)| (source.to_string(), home.join(rel)))
                .collect(),
            None => Vec::new(),
        };
        Self {
            builtin,
            user,
            external,
        }
    }

    pub fn root(&self, source: &str) -> Option<&Path> {
        match source {
            SOURCE_USER => Some(&self.user),
            SOURCE_BUILTIN => Some(&self.builtin),
            other => self
                .external
                .iter()
                .find(|(s, _)| s == other)
                .map(|(_, p)| p.as_path()),
        }
    }

    /// Absolute directory of a skill on this device (it may not exist yet,
    /// e.g. a synced skill whose files are still being fetched).
    pub fn skill_dir(&self, source: &str, path: &str) -> Option<PathBuf> {
        if !super::manifest::is_safe_dir_name(path) {
            return None;
        }
        self.root(source).map(|root| root.join(path))
    }

    /// Absolute SKILL.md of a skill when it is present on this device.
    pub fn local_skill_md(&self, source: &str, path: &str) -> Option<PathBuf> {
        self.skill_dir(source, path)
            .map(|d| d.join("SKILL.md"))
            .filter(|p| p.is_file())
    }

    /// Where ChatShell parks skill directories it removes or replaces, so a
    /// sync decision never destroys files outright.
    pub fn trash_dir(&self) -> PathBuf {
        self.user.join(".trash")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roots_resolve_relative_paths_per_source() {
        let roots = SkillRoots::new(
            PathBuf::from("/app/builtin-skills"),
            Some(Path::new("/home/me")),
            Path::new("/data"),
        );
        assert_eq!(
            roots.skill_dir("user", "notes"),
            Some(PathBuf::from("/home/me/.chatshell/skills/notes"))
        );
        assert_eq!(
            roots.skill_dir("claude", "pdf"),
            Some(PathBuf::from("/home/me/.claude/skills/pdf"))
        );
        assert_eq!(
            roots.skill_dir("builtin", "skill-installer"),
            Some(PathBuf::from("/app/builtin-skills/skill-installer"))
        );
        assert_eq!(roots.skill_dir("unknown", "x"), None);
        assert_eq!(roots.skill_dir("user", "../etc"), None);
    }

    #[test]
    fn without_home_user_skills_live_in_app_data() {
        let roots = SkillRoots::new(PathBuf::from("/b"), None, Path::new("/data"));
        assert_eq!(roots.user, PathBuf::from("/data/skills"));
        assert!(roots.external.is_empty());
    }

    #[test]
    fn only_chatshell_and_builtin_sources_sync() {
        assert!(is_synced_source("user"));
        assert!(is_synced_source("builtin"));
        assert!(!is_synced_source("claude"));
        assert!(!is_synced_source("agents"));
    }
}
