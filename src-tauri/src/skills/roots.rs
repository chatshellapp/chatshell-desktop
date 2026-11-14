//! Where each skill source lives on this device.
//!
//! The `skills.path` column holds the skill's directory name relative to its
//! source root, never an absolute path: home directories and app bundle
//! locations differ between devices, and `user`/`builtin` rows sync.

use std::path::{Path, PathBuf};
use tauri::Manager;

/// ChatShell's own skills. They live in the app data directory and are
/// created through ChatShell, not dropped in by other tools or installers.
pub const SOURCE_USER: &str = "user";
/// Skills bundled with the app.
pub const SOURCE_BUILTIN: &str = "builtin";

/// Where ChatShell's own skills lived before they moved to the app data
/// directory (relative to home). Its contents are moved over once.
const LEGACY_USER_ROOT: &str = ".chatshell/skills";

/// Well-known skill directories of other agents (beyond ChatShell's own):
/// `(source, path relative to home, settings key of the enable toggle)`.
/// Their skills are indexed on this device only and never synced. Skills
/// installed from the internet go to `~/.agents/skills`, so they stay on
/// the device they were installed on.
pub const EXTERNAL_SKILL_SOURCES: &[(&str, &str, &str)] = &[
    ("claude", ".claude/skills", "skill_source_claude_enabled"),
    ("agents", ".agents/skills", "skill_source_agents_enabled"),
];

/// Whether rows of `source` sync between devices (mirrors core's
/// `SYNCED_SKILL_SOURCES`, which enforces it in the merge).
pub fn is_synced_source(source: &str) -> bool {
    chatshell_agent_core::sync::SYNCED_SKILL_SOURCES.contains(&source)
}

/// ChatShell's own skills folder inside the app data directory. The host
/// registers it as an exception to the private app data directory, so the
/// agent can read, run and write skills there.
pub fn user_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("skills")
}

#[derive(Debug, Clone)]
pub struct SkillRoots {
    pub builtin: PathBuf,
    pub user: PathBuf,
    /// Where removed or replaced user skill folders go. Outside `user`:
    /// the agent may read and write `user`, but trashed skills stay private.
    pub trash: PathBuf,
    /// Pre-move location of `user` (`~/.chatshell/skills`), if there is a home
    pub legacy_user: Option<PathBuf>,
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
        let roots = Self::new(builtin, home.as_deref(), &app_data_dir);
        // Fail instead of handing out roots that would make reconcile see
        // every not-yet-moved skill as deleted.
        match roots.relocate_legacy_user_root() {
            Ok(0) => {}
            Ok(moved) => tracing::info!(
                "[skills] Moved {moved} item(s) from ~/{LEGACY_USER_ROOT} to {}",
                roots.user.display()
            ),
            Err(err) => {
                return Err(format!(
                    "Failed to move skills from ~/{LEGACY_USER_ROOT} to {}: {err}",
                    roots.user.display()
                ));
            }
        }
        Ok(roots)
    }

    pub fn new(builtin: PathBuf, home: Option<&Path>, app_data_dir: &Path) -> Self {
        let user = user_root(app_data_dir);
        let trash = app_data_dir.join("skills-trash");
        let legacy_user = home.map(|home| home.join(LEGACY_USER_ROOT));
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
            trash,
            legacy_user,
            external,
        }
    }

    /// Move skill folders left in the legacy root (`~/.chatshell/skills`)
    /// into the app data root. Must run before reconcile: a synced skill
    /// whose folder is missing here would otherwise count as deleted on this
    /// device and be deleted on every device. Entries whose name already
    /// exists in the new root stay where they are. Returns how many moved.
    pub fn relocate_legacy_user_root(&self) -> std::io::Result<usize> {
        let Some(legacy) = self.legacy_user.as_deref() else {
            return Ok(0);
        };
        if !legacy.is_dir() || legacy == self.user {
            return Ok(0);
        }
        std::fs::create_dir_all(&self.user)?;
        let mut moved = 0;
        for entry in std::fs::read_dir(legacy)? {
            let entry = entry?;
            // The old trash lived inside the skills root; keep it private.
            let target = if entry.file_name() == ".trash" {
                self.trash.clone()
            } else {
                self.user.join(entry.file_name())
            };
            if target.exists() {
                tracing::warn!(
                    "[skills] Not moving {}: {} already exists",
                    entry.path().display(),
                    target.display()
                );
                continue;
            }
            std::fs::rename(entry.path(), &target)?;
            moved += 1;
        }
        // Only succeeds once the legacy root is empty.
        let _ = std::fs::remove_dir(legacy);
        Ok(moved)
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
        self.trash.clone()
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
            Some(PathBuf::from("/data/skills/notes"))
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
        assert!(roots.legacy_user.is_none());
        assert!(roots.external.is_empty());
    }

    #[test]
    fn legacy_user_skills_move_to_app_data() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let data = tmp.path().join("data");
        let roots = SkillRoots::new(PathBuf::from("/b"), Some(&home), &data);
        let legacy = roots.legacy_user.clone().unwrap();
        for name in ["notes", "clash", ".trash/old"] {
            std::fs::create_dir_all(legacy.join(name)).unwrap();
            std::fs::write(legacy.join(name).join("SKILL.md"), name).unwrap();
        }
        std::fs::create_dir_all(roots.user.join("clash")).unwrap();

        assert_eq!(roots.relocate_legacy_user_root().unwrap(), 2);
        assert!(roots.trash.join("old/SKILL.md").is_file());
        assert!(!roots.user.join(".trash").exists());
        assert_eq!(
            std::fs::read_to_string(roots.user.join("notes/SKILL.md")).unwrap(),
            "notes"
        );
        // A clash stays behind (and keeps the legacy root alive).
        assert!(legacy.join("clash/SKILL.md").is_file());
        assert!(!roots.user.join("clash/SKILL.md").exists());

        std::fs::remove_dir_all(legacy.join("clash")).unwrap();
        assert_eq!(roots.relocate_legacy_user_root().unwrap(), 0);
        assert!(!legacy.exists());
    }

    #[test]
    fn only_chatshell_and_builtin_sources_sync() {
        assert!(is_synced_source("user"));
        assert!(is_synced_source("builtin"));
        assert!(!is_synced_source("claude"));
        assert!(!is_synced_source("agents"));
    }
}
