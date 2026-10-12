//! Obscura headless-browser integration (desktop tiers for fetch and search).
//!
//! Obscura (https://github.com/h4ckf0r0day/obscura) is a Rust headless browser
//! engine: embedded V8, anti-detection, ~70 MiB single binary, no Chrome or
//! Node.js required. It is used as the preferred browser tier before headless
//! Chrome for two workloads:
//!
//! - `web_fetch`: fallback when direct HTTP fails or returns a non-200 status
//! - `web_search`: scraping search-engine result pages
//!
//! Obscura is an *opportunistic* tier: nothing is bundled and no user
//! configuration is required. When the binary is present on the machine it
//! takes precedence over the system-WebView tier (see `webview_fetch.rs`);
//! otherwise it is skipped entirely. Resolution order:
//!
//! 1. `CHATSHELL_OBSCURA_PATH` env var (debug/power-user override)
//! 2. `obscura` next to the app executable
//! 3. `obscura` executable found on `PATH`
//!
//! Additional knobs:
//!
//! - `CHATSHELL_OBSCURA_TIMEOUT_SECS` (default 30): hard per-fetch budget,
//!   including process startup, navigation, and post-load settling.
//!
//! `--stealth` is always passed: builds without the `stealth` feature degrade
//! gracefully to tracker blocking, so the flag is safe on every build.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::process::Command;

const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Resolve the binary on every call. A PATH scan is a handful of `stat`s, so
/// no caching — this lets a freshly installed binary (or an env change) take
/// effect without an app restart, which the settings UI relies on.
fn resolve_binary() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let resolved = resolve_binary_from(
        std::env::var("CHATSHELL_OBSCURA_PATH").ok().as_deref(),
        exe_dir.as_deref(),
        std::env::var_os("PATH"),
    );
    match &resolved {
        Some(path) => tracing::debug!("[obscura] Using binary at {}", path.display()),
        None => tracing::trace!("[obscura] Binary not found, tier skipped"),
    }
    resolved
}

/// Check whether `dir` contains an executable obscura binary.
fn probe_dir(dir: &Path) -> Option<PathBuf> {
    if !dir.is_dir() {
        return None;
    }
    #[cfg(windows)]
    let candidates = ["obscura.exe", "obscura.cmd", "obscura.bat", "obscura"];
    #[cfg(not(windows))]
    let candidates = ["obscura"];

    for name in candidates {
        let candidate = dir.join(name);
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    #[cfg(windows)]
    {
        path.is_file()
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    }
}

/// Pure binary resolution, separated from the process environment for tests.
/// `explicit` is the `CHATSHELL_OBSCURA_PATH` value, `exe_dir` the directory
/// containing the app executable (bundled sidecar location), `path_dirs` the
/// entries of the `PATH` environment variable.
pub(crate) fn resolve_binary_from(
    explicit: Option<&str>,
    exe_dir: Option<&Path>,
    path_dirs: Option<std::ffi::OsString>,
) -> Option<PathBuf> {
    if let Some(value) = explicit {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            tracing::warn!("[obscura] CHATSHELL_OBSCURA_PATH is set but empty, ignoring");
        } else {
            let path = PathBuf::from(trimmed);
            if path.is_file() {
                return Some(path);
            }
            tracing::warn!(
                "[obscura] CHATSHELL_OBSCURA_PATH points to a missing file: {}, falling back to bundled/PATH lookup",
                trimmed
            );
        }
    }

    // Bundled sidecar: shipped next to the app executable by bundle.externalBin.
    if let Some(found) = exe_dir.and_then(probe_dir) {
        return Some(found);
    }

    let dirs = path_dirs?;
    for dir in std::env::split_paths(&dirs) {
        if let Some(found) = probe_dir(&dir) {
            return Some(found);
        }
    }
    None
}

/// Whether an obscura binary is installed on this machine.
pub fn is_configured() -> bool {
    resolve_binary().is_some()
}

/// Per-fetch timeout from `CHATSHELL_OBSCURA_TIMEOUT_SECS`, clamped to >= 5s.
fn timeout() -> Duration {
    let secs = std::env::var("CHATSHELL_OBSCURA_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .max(5);
    Duration::from_secs(secs)
}

/// CLI arguments for one `obscura fetch` invocation (pure, for tests).
pub(crate) fn build_fetch_args(url: &str, timeout_secs: u64) -> Vec<String> {
    vec![
        "fetch".to_string(),
        url.to_string(),
        "--dump".to_string(),
        "html".to_string(),
        "--wait-until".to_string(),
        "networkidle0".to_string(),
        "--timeout".to_string(),
        timeout_secs.saturating_sub(5).max(1).to_string(),
        "--stealth".to_string(),
        "--quiet".to_string(),
    ]
}

/// Fetch a page's rendered HTML through obscura.
pub async fn fetch_html(url: &str) -> Result<String> {
    let binary = resolve_binary().context("obscura binary is not configured")?;
    run_fetch(&binary, url, timeout()).await
}

/// Run `obscura fetch` with an injected binary path and timeout. Separated
/// from `fetch_html` so tests can stub the binary without touching the env.
async fn run_fetch(binary: &Path, url: &str, timeout: Duration) -> Result<String> {
    let args = build_fetch_args(url, timeout.as_secs());
    tracing::info!("[obscura] Fetching {} (timeout {:?})", url, timeout);

    let child = Command::new(binary)
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("failed to spawn obscura at {}", binary.display()))?;

    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(result) => result?,
        Err(_) => {
            // wait_with_output consumed the child; kill_on_drop already
            // reaps it when the future is dropped by the timeout.
            return Err(anyhow::anyhow!(
                "obscura fetch timed out after {:?}",
                timeout
            ));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_tail = stderr.trim().lines().last().unwrap_or_default();
        return Err(anyhow::anyhow!(
            "obscura fetch exited with {}: {}",
            output.status,
            stderr_tail
        ));
    }

    let html = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if html.is_empty() {
        return Err(anyhow::anyhow!("obscura fetch returned empty output"));
    }
    tracing::info!("[obscura] Fetched {} bytes of HTML for {}", html.len(), url);
    Ok(html)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_fetch_args_includes_stealth_and_quiet() {
        let args = build_fetch_args("https://example.com", 30);
        assert_eq!(args[0], "fetch");
        assert_eq!(args[1], "https://example.com");
        assert!(args.contains(&"--stealth".to_string()));
        assert!(args.contains(&"--quiet".to_string()));
        assert!(args.contains(&"networkidle0".to_string()));
        // Navigation timeout leaves headroom below the hard process budget.
        let timeout_flag = args.iter().position(|a| a == "--timeout").unwrap();
        assert_eq!(args[timeout_flag + 1], "25");
    }

    #[test]
    fn test_resolve_binary_explicit_path_wins() {
        let existing = std::env::current_exe().unwrap();
        let resolved = resolve_binary_from(
            Some(existing.to_str().unwrap()),
            None,
            Some(std::env::join_paths(iter::once("/definitely/not/here")).unwrap()),
        );
        assert_eq!(resolved.as_deref(), Some(existing.as_path()));
    }

    #[test]
    fn test_resolve_binary_missing_explicit_falls_back_to_path() {
        // Empty PATH, no exe dir: nothing can be found, explicit path missing.
        let resolved = resolve_binary_from(
            Some("/definitely/not/here/obscura"),
            None,
            Some(std::env::join_paths(Vec::<PathBuf>::new()).unwrap()),
        );
        assert!(resolved.is_none());
    }

    #[test]
    fn test_resolve_binary_ignores_empty_explicit() {
        let resolved = resolve_binary_from(
            Some("  "),
            None,
            Some(std::env::join_paths(Vec::<PathBuf>::new()).unwrap()),
        );
        assert!(resolved.is_none());
    }

    #[test]
    fn test_resolve_binary_prefers_bundled_sidecar_over_path() {
        let exe_dir = std::env::temp_dir().join("chatshell-obscura-test-sidecar");
        std::fs::create_dir_all(&exe_dir).unwrap();
        #[cfg(unix)]
        let sidecar = exe_dir.join("obscura");
        #[cfg(not(unix))]
        let sidecar = exe_dir.join("obscura.exe");
        std::fs::write(&sidecar, b"stub").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sidecar, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        // Sidecar wins over any PATH entry.
        let resolved = resolve_binary_from(
            None,
            Some(&exe_dir),
            Some(std::env::join_paths(iter::once("/definitely/not/here")).unwrap()),
        );
        assert_eq!(resolved.as_deref(), Some(sidecar.as_path()));

        // Explicit env override still wins over the sidecar.
        let existing = std::env::current_exe().unwrap();
        let resolved = resolve_binary_from(Some(existing.to_str().unwrap()), Some(&exe_dir), None);
        assert_eq!(resolved.as_deref(), Some(existing.as_path()));
    }

    use std::iter;

    #[tokio::test]
    async fn test_run_fetch_returns_stdout_html() {
        let dir = std::env::temp_dir().join("chatshell-obscura-test-stub");
        std::fs::create_dir_all(&dir).unwrap();
        let stub = dir.join("obscura-stub");
        #[cfg(unix)]
        {
            std::fs::write(
                &stub,
                "#!/bin/sh\n# $1=fetch $2=url $3=--dump ... \necho '<html>stub</html>'\n",
            )
            .unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        #[cfg(not(unix))]
        std::fs::write(&stub, "@echo <html>stub</html>").unwrap();

        let html = run_fetch(&stub, "https://example.com", Duration::from_secs(10))
            .await
            .unwrap();
        assert_eq!(html, "<html>stub</html>");
    }

    #[tokio::test]
    async fn test_run_fetch_times_out() {
        let dir = std::env::temp_dir().join("chatshell-obscura-test-stub");
        std::fs::create_dir_all(&dir).unwrap();
        let stub = dir.join("obscura-sleep-stub");
        #[cfg(unix)]
        {
            std::fs::write(&stub, "#!/bin/sh\nsleep 30\n").unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        #[cfg(not(unix))]
        std::fs::write(&stub, "@ping -n 30 127.0.0.1 > nul").unwrap();

        let start = std::time::Instant::now();
        let result = run_fetch(&stub, "https://example.com", Duration::from_secs(5)).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(20));
    }
}
