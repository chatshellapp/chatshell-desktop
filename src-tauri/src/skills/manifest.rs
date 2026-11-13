//! Skill file manifests.
//!
//! A skill is a directory, not just its SKILL.md: scripts, references and
//! templates next to it are part of the skill. The manifest lists every file
//! that belongs to a skill with its BLAKE3 digest, so that
//!
//! - change detection covers the whole directory (editing a script is a
//!   change, not only editing SKILL.md), and
//! - ChatShell's own skills can travel between devices as content-addressed
//!   blobs (one blob per file, deduplicated across versions and skills).
//!
//! Hidden entries, dependency/cache directories and symlinks are never part
//! of a skill: they are machine-specific, often huge, and a symlink could
//! point anywhere on the authoring device.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use ts_rs::TS;

/// Upper bound on files per skill; anything larger is not a skill.
pub const MAX_SKILL_FILES: usize = 500;
/// Upper bound on the summed size of a skill's files.
pub const MAX_SKILL_BYTES: u64 = 50 * 1024 * 1024;

/// Directory names skipped while walking a skill (besides dot-entries).
const SKIPPED_DIRS: &[&str] = &["node_modules", "__pycache__", "target", "venv"];

/// One file of a skill directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SkillFile {
    /// Path relative to the skill directory, `/`-separated.
    pub path: String,
    /// BLAKE3 hex digest of the file bytes (also its blob name).
    pub hash: String,
    #[ts(type = "number")]
    pub size: u64,
    /// Whether the owner-execute bit was set (scripts).
    #[serde(default)]
    pub executable: bool,
}

/// Walk `dir` and describe every file that belongs to the skill, sorted by
/// path so the manifest (and its hash) is deterministic.
pub fn build_manifest(dir: &Path) -> Result<Vec<SkillFile>> {
    let mut files = Vec::new();
    let mut total = 0u64;
    walk(dir, dir, &mut files, &mut total)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn walk(base: &Path, current: &Path, out: &mut Vec<SkillFile>, total: &mut u64) -> Result<()> {
    let mut entries: Vec<_> = std::fs::read_dir(current)
        .with_context(|| format!("read {}", current.display()))?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with('.') {
            continue;
        }
        // symlink_metadata: never follow links out of the skill.
        let Ok(meta) = std::fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if SKIPPED_DIRS.contains(&name) {
                continue;
            }
            walk(base, &entry.path(), out, total)?;
        } else if meta.is_file() {
            if out.len() >= MAX_SKILL_FILES {
                bail!(
                    "skill {} has more than {MAX_SKILL_FILES} files",
                    base.display()
                );
            }
            *total += meta.len();
            if *total > MAX_SKILL_BYTES {
                bail!(
                    "skill {} is larger than {MAX_SKILL_BYTES} bytes",
                    base.display()
                );
            }
            let bytes = std::fs::read(entry.path()).with_context(|| format!("read {}", name))?;
            let rel = entry
                .path()
                .strip_prefix(base)
                .map(|p| {
                    p.components()
                        .filter_map(|c| c.as_os_str().to_str())
                        .collect::<Vec<_>>()
                        .join("/")
                })
                .unwrap_or_else(|_| name.to_string());
            out.push(SkillFile {
                path: rel,
                hash: crate::storage::hash_bytes(&bytes),
                size: bytes.len() as u64,
                executable: is_executable(&meta),
            });
        }
    }
    Ok(())
}

#[cfg(unix)]
fn is_executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o100 != 0
}

#[cfg(not(unix))]
fn is_executable(_meta: &std::fs::Metadata) -> bool {
    false
}

/// Digest of a whole manifest: the skill's content hash. Any added,
/// removed, renamed, edited or chmod-ed file changes it.
pub fn manifest_hash(files: &[SkillFile]) -> String {
    let mut hasher = blake3::Hasher::new();
    for f in files {
        hasher.update(f.path.as_bytes());
        hasher.update(&[0]);
        hasher.update(f.hash.as_bytes());
        hasher.update(&[if f.executable { 1 } else { 0 }]);
        hasher.update(&[0]);
    }
    hasher.finalize().to_hex().to_string()
}

/// Resolve a manifest path below `dir`, refusing anything that could escape
/// it (absolute paths, `..`, prefixes). Manifests arrive from peers, so this
/// is the trust boundary for materialization.
pub fn safe_join(dir: &Path, rel: &str) -> Result<PathBuf> {
    let rel_path = Path::new(rel);
    if rel.is_empty()
        || !rel_path
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
    {
        bail!("unsafe skill file path: {rel:?}");
    }
    Ok(dir.join(rel_path))
}

/// Same rule for a skill directory name below a source root.
pub fn is_safe_dir_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && !name.contains('/')
        && !name.contains('\\')
        && Path::new(name)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn manifest_lists_files_sorted_and_skips_noise() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write(&dir.join("SKILL.md"), b"# skill");
        write(&dir.join("scripts/run.sh"), b"echo hi");
        write(&dir.join("references/a.md"), b"ref");
        write(&dir.join(".git/HEAD"), b"ref: main");
        write(&dir.join(".DS_Store"), b"junk");
        write(&dir.join("node_modules/x/index.js"), b"big");

        let files = build_manifest(dir).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["SKILL.md", "references/a.md", "scripts/run.sh"]);
        assert_eq!(files[0].hash, crate::storage::hash_bytes(b"# skill"));
        assert_eq!(files[0].size, 7);
    }

    #[cfg(unix)]
    #[test]
    fn manifest_records_executable_bit_and_skips_symlinks() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write(&dir.join("SKILL.md"), b"# skill");
        write(&dir.join("run.sh"), b"#!/bin/sh");
        std::fs::set_permissions(dir.join("run.sh"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        std::os::unix::fs::symlink("/etc/hosts", dir.join("hosts")).unwrap();

        let files = build_manifest(dir).unwrap();
        assert_eq!(files.len(), 2, "{files:?}");
        let run = files.iter().find(|f| f.path == "run.sh").unwrap();
        assert!(run.executable);
        let before = manifest_hash(&files);
        std::fs::set_permissions(dir.join("run.sh"), std::fs::Permissions::from_mode(0o644))
            .unwrap();
        assert_ne!(before, manifest_hash(&build_manifest(dir).unwrap()));
    }

    #[test]
    fn manifest_hash_tracks_every_file() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write(&dir.join("SKILL.md"), b"# skill");
        let base = manifest_hash(&build_manifest(dir).unwrap());
        write(&dir.join("scripts/run.sh"), b"echo hi");
        let added = manifest_hash(&build_manifest(dir).unwrap());
        assert_ne!(base, added);
        write(&dir.join("scripts/run.sh"), b"echo bye");
        assert_ne!(added, manifest_hash(&build_manifest(dir).unwrap()));
    }

    #[test]
    fn oversized_skill_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write(&dir.join("SKILL.md"), b"# skill");
        for i in 0..MAX_SKILL_FILES {
            write(&dir.join(format!("f/{i}.txt")), b"x");
        }
        assert!(build_manifest(dir).is_err());
    }

    #[test]
    fn safe_join_refuses_escapes() {
        let dir = Path::new("/skills/demo");
        assert!(safe_join(dir, "SKILL.md").is_ok());
        assert!(safe_join(dir, "scripts/run.sh").is_ok());
        for bad in ["", "../x", "a/../../x", "/etc/passwd", "./x"] {
            assert!(safe_join(dir, bad).is_err(), "{bad}");
        }
        assert!(is_safe_dir_name("pdf-tools"));
        for bad in ["", ".", "..", ".hidden", "a/b", "a\\b"] {
            assert!(!is_safe_dir_name(bad), "{bad}");
        }
    }
}
