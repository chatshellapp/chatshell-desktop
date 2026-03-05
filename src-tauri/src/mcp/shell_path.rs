//! Resolve the user's full shell PATH on macOS.
//!
//! macOS GUI apps launched from Finder/Spotlight inherit a minimal PATH
//! (/usr/bin:/bin:/usr/sbin:/sbin). This module resolves the full PATH
//! by running the user's login shell, with fallbacks.

use std::sync::OnceLock;

static RESOLVED_PATH: OnceLock<Option<String>> = OnceLock::new();

/// Resolve the user's full shell PATH. The result is cached after the first call.
///
/// Strategy:
/// 1. Run `$SHELL -ilc` (interactive login) to source .zshrc/.bashrc where
///    tools like nvm configure PATH
/// 2. Fallback: Run `$SHELL -lc` (login only) for .zprofile/.bash_profile
/// 3. Fallback: Read macOS system paths from /etc/paths and /etc/paths.d/*
/// 4. Returns None only if all strategies fail
#[cfg(target_os = "macos")]
pub fn resolve_shell_path() -> Option<String> {
    RESOLVED_PATH
        .get_or_init(|| {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

            // Try interactive login shell first (sources .zshrc where nvm lives)
            if let Some(path) = run_shell_for_path(&shell, &["-ilc"]) {
                return Some(path);
            }

            // Fallback: login shell only (sources .zprofile)
            if let Some(path) = run_shell_for_path(&shell, &["-lc"]) {
                return Some(path);
            }

            // Fallback: read macOS system paths from /etc/paths + /etc/paths.d/*
            read_etc_paths()
        })
        .clone()
}

#[cfg(not(target_os = "macos"))]
pub fn resolve_shell_path() -> Option<String> {
    None
}

/// Run the user's shell with given flags and extract PATH from stdout.
#[cfg(target_os = "macos")]
fn run_shell_for_path(shell: &str, flags: &[&str]) -> Option<String> {
    let mut args: Vec<&str> = flags.to_vec();
    args.push("printf '%s' \"$PATH\"");

    let output = std::process::Command::new(shell)
        .args(&args)
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Sanity check: a valid PATH should contain at least /usr/bin
    if path.contains("/usr/bin") {
        Some(path)
    } else {
        None
    }
}

/// Read system-level PATH entries from /etc/paths and /etc/paths.d/*.
#[cfg(target_os = "macos")]
fn read_etc_paths() -> Option<String> {
    let mut paths: Vec<String> = Vec::new();

    if let Ok(contents) = std::fs::read_to_string("/etc/paths") {
        for line in contents.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                paths.push(trimmed.to_string());
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir("/etc/paths.d") {
        let mut sorted: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        sorted.sort_by_key(|e| e.file_name());
        for entry in sorted {
            if let Ok(contents) = std::fs::read_to_string(entry.path()) {
                for line in contents.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !paths.contains(&trimmed.to_string()) {
                        paths.push(trimmed.to_string());
                    }
                }
            }
        }
    }

    if paths.is_empty() {
        None
    } else {
        Some(paths.join(":"))
    }
}
