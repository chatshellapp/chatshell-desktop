//! Shared path security policy for all tools.
//!
//! Provides read and write access checks that protect sensitive files and
//! enforce project-directory boundaries. Used by built-in tools (read, write,
//! edit, grep, glob) directly, and by MCP STDIO argument scanning via
//! heuristic helpers.

use std::path::{Component, Path, PathBuf};

// ---------------------------------------------------------------------------
// Read blocklist
// ---------------------------------------------------------------------------

/// Home-relative path prefixes that must never be read.
const READ_BLOCKED_HOME_PREFIXES: &[&str] = &[
    ".ssh/id_",
    ".ssh/id_rsa",
    ".ssh/id_ed25519",
    ".ssh/id_ecdsa",
    ".ssh/id_dsa",
    ".ssh/known_hosts",
    ".gnupg/",
    ".aws/credentials",
    ".docker/config.json",
    ".kube/config",
    ".npmrc",
    ".pypirc",
];

/// Absolute path prefixes that must never be read.
const READ_BLOCKED_ABSOLUTE: &[&str] = &["/etc/shadow", "/etc/gshadow", "/etc/master.passwd"];

/// Filenames (basename) that must never be read regardless of location.
const READ_BLOCKED_FILENAMES: &[&str] = &[
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging",
    ".env.development",
    "credentials.json",
    "service-account.json",
    "service_account.json",
    "secrets.yaml",
    "secrets.yml",
];

// ---------------------------------------------------------------------------
// Write blocklist
// ---------------------------------------------------------------------------

/// Relative path prefixes inside a repository that must never be written.
const WRITE_BLOCKED_REPO_PREFIXES: &[&str] = &[
    ".git/hooks/",
    ".git/hooks",
    ".git/config",
    ".git/objects/",
    ".git/objects",
    ".git/refs/",
    ".git/refs",
    ".git/HEAD",
    ".git/index",
];

/// Home-relative paths that must never be written.
const WRITE_BLOCKED_HOME: &[&str] = &[
    ".bashrc",
    ".zshrc",
    ".profile",
    ".bash_profile",
    ".bash_login",
    ".zshenv",
    ".zlogin",
    ".zprofile",
    ".ssh/",
    ".gnupg/",
    ".gitconfig",
];

/// Absolute path prefixes that must never be written.
const WRITE_BLOCKED_ABSOLUTE: &[&str] =
    &["/etc/", "/usr/", "/bin/", "/sbin/", "/System/", "/Library/"];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Check whether reading `path` is allowed.
///
/// Returns `Ok(())` if the read is permitted, or `Err(reason)` if it should
/// be blocked.  No directory boundary is enforced for reads — the LLM needs
/// to read broadly for context.
pub fn check_read(path: &Path, _project_root: Option<&Path>) -> Result<(), String> {
    let normalized = normalize_path(path);
    let path_str = normalized.to_string_lossy();

    // Absolute blocklist
    for blocked in READ_BLOCKED_ABSOLUTE {
        if path_str.starts_with(blocked) {
            return Err(format!(
                "Read blocked: sensitive system file ({})",
                path.display()
            ));
        }
    }

    // Home-relative blocklist
    if let Some(home) = home_dir() {
        let home_str = home.to_string_lossy();
        if let Some(rel) = path_str.strip_prefix(home_str.as_ref()) {
            let rel = rel.trim_start_matches('/');
            for blocked in READ_BLOCKED_HOME_PREFIXES {
                if rel.starts_with(blocked) {
                    return Err(format!("Read blocked: sensitive user file (~/{blocked})"));
                }
            }
        }
    }

    // Filename blocklist
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        for blocked in READ_BLOCKED_FILENAMES {
            if name == *blocked {
                return Err(format!("Read blocked: sensitive filename ({name})"));
            }
        }
    }

    Ok(())
}

/// Check whether writing to `path` is allowed.
///
/// Two layers:
/// 1. Absolute blocklist — certain paths are never writable.
/// 2. Project boundary — when `project_root` is `Some`, writes must land
///    inside that directory tree.
pub fn check_write(path: &Path, project_root: Option<&Path>) -> Result<(), String> {
    let normalized = normalize_path(path);
    let path_str = normalized.to_string_lossy();

    // Layer 1a: absolute path blocklist
    for blocked in WRITE_BLOCKED_ABSOLUTE {
        if path_str.starts_with(blocked) {
            return Err(format!(
                "Write blocked: protected system directory ({})",
                path.display()
            ));
        }
    }

    // Layer 1b: home-relative blocklist
    if let Some(home) = home_dir() {
        let home_str = home.to_string_lossy();
        if let Some(rel) = path_str.strip_prefix(home_str.as_ref()) {
            let rel = rel.trim_start_matches('/');
            for blocked in WRITE_BLOCKED_HOME {
                if rel == blocked.trim_end_matches('/') || rel.starts_with(blocked) {
                    return Err(format!("Write blocked: protected user file (~/{blocked})"));
                }
            }
        }
    }

    // Layer 1c: repo-internal paths (checked relative to the path itself)
    for blocked in WRITE_BLOCKED_REPO_PREFIXES {
        if contains_component_prefix(&path_str, blocked) {
            return Err(format!(
                "Write blocked: protected repository path ({blocked})"
            ));
        }
    }

    // Layer 2: project boundary
    if let Some(root) = project_root {
        let root_normalized = normalize_path(root);
        if !normalized.starts_with(&root_normalized) {
            return Err(format!(
                "Write blocked: outside project directory ({} is not under {})",
                path.display(),
                root.display()
            ));
        }
    }

    Ok(())
}

/// Heuristic: does the string look like a filesystem path?
///
/// Used by MCP argument scanning to decide whether to run path checks on a
/// string value.
pub fn looks_like_path(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.is_empty() || trimmed.len() > 4096 {
        return false;
    }
    trimmed.starts_with('/')
        || trimmed.starts_with("~/")
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
}

/// Check a raw string against both read and write blocklists.
///
/// Used by MCP STDIO argument scanning where we don't know whether the string
/// will be used for reading or writing.  If it matches *either* blocklist, the
/// call is rejected.
pub fn check_blocked_path(s: &str) -> Result<(), String> {
    if !looks_like_path(s) {
        return Ok(());
    }

    let path = expand_tilde(s);
    check_read(&path, None)?;
    check_write(&path, None)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Expand a leading `~` to the user's home directory.
fn expand_tilde(s: &str) -> PathBuf {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(s)
}

/// Normalize a path by resolving `.` and `..` components lexically (without
/// touching the filesystem).  This prevents `../../etc/shadow` bypasses
/// while still working for paths that don't exist yet (write/create).
fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// Check if a path string contains a component prefix like `.git/hooks/`
/// anywhere in its path (not just at the start).
fn contains_component_prefix(path_str: &str, prefix: &str) -> bool {
    // Check at end of path
    if path_str.ends_with(prefix.trim_end_matches('/')) {
        // Make sure it's a component boundary
        let before = &path_str[..path_str.len() - prefix.trim_end_matches('/').len()];
        if before.is_empty() || before.ends_with('/') {
            return true;
        }
    }

    // Check with trailing slash (prefix is a directory)
    let search = if prefix.ends_with('/') {
        format!("/{prefix}")
    } else {
        format!("/{prefix}/")
    };
    if path_str.contains(&search) {
        return true;
    }

    // Check at start of path
    path_str.starts_with(prefix) || path_str.starts_with(&format!("/{prefix}"))
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- check_read -------------------------------------------------------

    #[test]
    fn read_blocks_etc_shadow() {
        assert!(check_read(Path::new("/etc/shadow"), None).is_err());
        assert!(check_read(Path::new("/etc/gshadow"), None).is_err());
        assert!(check_read(Path::new("/etc/master.passwd"), None).is_err());
    }

    #[test]
    fn read_blocks_ssh_keys() {
        let home = home_dir().unwrap();
        assert!(check_read(&home.join(".ssh/id_rsa"), None).is_err());
        assert!(check_read(&home.join(".ssh/id_ed25519"), None).is_err());
        assert!(check_read(&home.join(".ssh/id_ecdsa"), None).is_err());
    }

    #[test]
    fn read_blocks_sensitive_filenames() {
        assert!(check_read(Path::new("/some/project/.env"), None).is_err());
        assert!(check_read(Path::new("/app/.env.local"), None).is_err());
        assert!(check_read(Path::new("/app/.env.production"), None).is_err());
        assert!(check_read(Path::new("/app/credentials.json"), None).is_err());
        assert!(check_read(Path::new("/app/secrets.yaml"), None).is_err());
    }

    #[test]
    fn read_blocks_cloud_credentials() {
        let home = home_dir().unwrap();
        assert!(check_read(&home.join(".aws/credentials"), None).is_err());
        assert!(check_read(&home.join(".docker/config.json"), None).is_err());
        assert!(check_read(&home.join(".kube/config"), None).is_err());
        assert!(check_read(&home.join(".npmrc"), None).is_err());
    }

    #[test]
    fn read_allows_normal_files() {
        assert!(check_read(Path::new("/tmp/test.rs"), None).is_ok());
        assert!(check_read(Path::new("/usr/include/stdio.h"), None).is_ok());
        assert!(check_read(Path::new("/home/user/project/src/main.rs"), None).is_ok());
    }

    #[test]
    fn read_allows_ssh_config() {
        let home = home_dir().unwrap();
        assert!(check_read(&home.join(".ssh/config"), None).is_ok());
    }

    // ---- check_write ------------------------------------------------------

    #[test]
    fn write_blocks_system_dirs() {
        assert!(check_write(Path::new("/etc/nginx/nginx.conf"), None).is_err());
        assert!(check_write(Path::new("/usr/local/bin/app"), None).is_err());
        assert!(check_write(Path::new("/bin/sh"), None).is_err());
        assert!(check_write(Path::new("/sbin/init"), None).is_err());
    }

    #[test]
    fn write_blocks_shell_configs() {
        let home = home_dir().unwrap();
        assert!(check_write(&home.join(".bashrc"), None).is_err());
        assert!(check_write(&home.join(".zshrc"), None).is_err());
        assert!(check_write(&home.join(".profile"), None).is_err());
        assert!(check_write(&home.join(".bash_profile"), None).is_err());
        assert!(check_write(&home.join(".zshenv"), None).is_err());
    }

    #[test]
    fn write_blocks_git_internals() {
        assert!(check_write(Path::new("/project/.git/hooks/pre-commit"), None).is_err());
        assert!(check_write(Path::new("/project/.git/config"), None).is_err());
        assert!(check_write(Path::new("/project/.git/objects/ab/cdef"), None).is_err());
        assert!(check_write(Path::new("/project/.git/refs/heads/main"), None).is_err());
        assert!(check_write(Path::new("/project/.git/HEAD"), None).is_err());
    }

    #[test]
    fn write_blocks_ssh_dir() {
        let home = home_dir().unwrap();
        assert!(check_write(&home.join(".ssh/authorized_keys"), None).is_err());
        assert!(check_write(&home.join(".ssh/id_rsa"), None).is_err());
    }

    #[test]
    fn write_allows_within_project() {
        let root = Path::new("/home/user/project");
        assert!(check_write(Path::new("/home/user/project/src/main.rs"), Some(root)).is_ok());
        assert!(check_write(Path::new("/home/user/project/new-file.txt"), Some(root)).is_ok());
    }

    #[test]
    fn write_blocks_outside_project() {
        let root = Path::new("/home/user/project");
        assert!(check_write(Path::new("/home/user/other/file.txt"), Some(root)).is_err());
        assert!(check_write(Path::new("/tmp/file.txt"), Some(root)).is_err());
    }

    #[test]
    fn write_traversal_blocked() {
        let root = Path::new("/home/user/project");
        assert!(check_write(Path::new("/home/user/project/../../etc/passwd"), Some(root)).is_err());
    }

    #[test]
    fn write_no_project_root_only_blocklist() {
        assert!(check_write(Path::new("/tmp/safe-file.txt"), None).is_ok());
        assert!(check_write(Path::new("/home/user/project/file.rs"), None).is_ok());
    }

    // ---- looks_like_path --------------------------------------------------

    #[test]
    fn looks_like_path_positive() {
        assert!(looks_like_path("/etc/shadow"));
        assert!(looks_like_path("~/Documents/file.txt"));
        assert!(looks_like_path("./relative/path"));
        assert!(looks_like_path("../parent/path"));
    }

    #[test]
    fn looks_like_path_negative() {
        assert!(!looks_like_path("hello world"));
        assert!(!looks_like_path("npm install"));
        assert!(!looks_like_path("SELECT * FROM users"));
        assert!(!looks_like_path(""));
    }

    // ---- check_blocked_path -----------------------------------------------

    #[test]
    fn blocked_path_catches_ssh_key() {
        let home = home_dir().unwrap();
        let path_str = format!("{}{}", home.display(), "/.ssh/id_rsa");
        assert!(check_blocked_path(&path_str).is_err());
    }

    #[test]
    fn blocked_path_catches_tilde_ssh() {
        assert!(check_blocked_path("~/.ssh/id_rsa").is_err());
    }

    #[test]
    fn blocked_path_catches_git_hooks() {
        assert!(check_blocked_path("/project/.git/hooks/pre-commit").is_err());
    }

    #[test]
    fn blocked_path_allows_normal() {
        assert!(check_blocked_path("/tmp/test.txt").is_ok());
        assert!(check_blocked_path("./src/main.rs").is_ok());
    }

    #[test]
    fn blocked_path_skips_non_paths() {
        assert!(check_blocked_path("hello world").is_ok());
        assert!(check_blocked_path("SELECT * FROM users").is_ok());
    }

    // ---- normalize_path ---------------------------------------------------

    #[test]
    fn normalize_resolves_dotdot() {
        assert_eq!(
            normalize_path(Path::new("/home/user/project/../../etc/shadow")),
            PathBuf::from("/home/etc/shadow")
        );
    }

    #[test]
    fn normalize_resolves_dot() {
        assert_eq!(
            normalize_path(Path::new("/home/./user/./project")),
            PathBuf::from("/home/user/project")
        );
    }

    #[test]
    fn normalize_preserves_clean_path() {
        assert_eq!(
            normalize_path(Path::new("/home/user/project/src/main.rs")),
            PathBuf::from("/home/user/project/src/main.rs")
        );
    }

    // ---- macOS-specific ---------------------------------------------------

    #[test]
    fn write_blocks_macos_system_dirs() {
        assert!(check_write(Path::new("/System/Library/something"), None).is_err());
        assert!(check_write(Path::new("/Library/LaunchDaemons/com.evil.plist"), None).is_err());
    }
}
