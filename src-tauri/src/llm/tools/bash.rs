//! Bash tool for LLM agents
//!
//! Provides a persistent bash session where environment variables, working directory,
//! and other state persist between calls. The session is lazily created on first use
//! and automatically recreated if it dies or times out.

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex as TokioMutex;

use super::bash_security::{self, SecurityVerdict};

/// Maximum output length returned to the LLM (chars)
const MAX_OUTPUT_CHARS: usize = 20_000;

/// Characters kept from the start when truncating
const TRUNCATE_HEAD_CHARS: usize = 5_000;

/// Characters kept from the end when truncating
const TRUNCATE_TAIL_CHARS: usize = 10_000;

/// Stop accumulating output beyond this to prevent OOM
const MAX_CAPTURE_BYTES: usize = 100_000;

const DEFAULT_TIMEOUT_SECS: u64 = 120;

// ---------------------------------------------------------------------------
// BashSession – persistent child process
// ---------------------------------------------------------------------------

struct CommandOutput {
    output: String,
    exit_code: i32,
}

pub(crate) struct BashSession {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
}

/// Shared handle to a bash session, used by both `BashTool` and `KillShellTool`.
pub(crate) type SharedBashSession = Arc<TokioMutex<Option<BashSession>>>;

/// Shared list of temp file paths created during output truncation.
pub type TempFileList = Arc<Mutex<Vec<PathBuf>>>;

impl fmt::Debug for BashSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BashSession")
            .field("pid", &self.child.id())
            .finish()
    }
}

impl BashSession {
    async fn new(cwd: &str) -> Result<Self, BashError> {
        let mut cmd = Command::new("bash");
        cmd.current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // stderr is redirected to stdout via `exec 2>&1` in init
            .stderr(Stdio::null());

        let mut child = cmd
            .spawn()
            .map_err(|e| BashError(format!("Failed to spawn bash: {}", e)))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| BashError("Failed to open bash stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| BashError("Failed to open bash stdout".into()))?;

        let mut session = Self {
            child,
            stdin,
            reader: BufReader::new(stdout),
        };

        session.initialize().await?;
        Ok(session)
    }

    /// Merge stderr into stdout, disable prompts, wait for ready marker.
    async fn initialize(&mut self) -> Result<(), BashError> {
        let marker = Self::make_marker("READY");
        let init = format!(
            "exec 2>&1\nexport PS1=''\nexport PS2=''\nexport PROMPT_COMMAND=''\necho {marker}\n"
        );

        self.stdin
            .write_all(init.as_bytes())
            .await
            .map_err(|e| BashError(format!("Init write failed: {}", e)))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| BashError(format!("Init flush failed: {}", e)))?;

        // Discard any bashrc / profile output until we see the marker
        tokio::time::timeout(Duration::from_secs(10), async {
            let mut buf = Vec::new();
            loop {
                buf.clear();
                let n = self
                    .reader
                    .read_until(b'\n', &mut buf)
                    .await
                    .map_err(|e| BashError(format!("Init read failed: {}", e)))?;
                if n == 0 {
                    return Err(BashError("Session ended during init".into()));
                }
                if String::from_utf8_lossy(&buf).trim() == marker {
                    return Ok(());
                }
            }
        })
        .await
        .map_err(|_| BashError("Session init timed out".into()))?
    }

    /// Execute a command, returning merged stdout+stderr and the exit code.
    async fn execute(
        &mut self,
        command: &str,
        timeout: Duration,
    ) -> Result<CommandOutput, BashError> {
        let marker = Self::make_marker("DONE");

        // The marker echo must be a separate command so $? captures the
        // exit code of the user's command, not something internal.
        let script = format!("{command}\necho {marker}$?\n");

        self.stdin
            .write_all(script.as_bytes())
            .await
            .map_err(|e| BashError(format!("Write failed: {}", e)))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| BashError(format!("Flush failed: {}", e)))?;

        let mut output = String::new();
        let mut capturing = true;

        let result = tokio::time::timeout(timeout, async {
            let mut buf = Vec::new();
            loop {
                buf.clear();
                let n = self
                    .reader
                    .read_until(b'\n', &mut buf)
                    .await
                    .map_err(|e| BashError(format!("Read failed: {}", e)))?;
                if n == 0 {
                    return Err(BashError("Session ended unexpectedly".into()));
                }

                let line = String::from_utf8_lossy(&buf);

                if let Some(rest) = line.strip_prefix(marker.as_str()) {
                    let exit_code = rest.trim().parse::<i32>().unwrap_or(-1);
                    return Ok(CommandOutput { output, exit_code });
                }

                if capturing {
                    output.push_str(&line);
                    if output.len() > MAX_CAPTURE_BYTES {
                        capturing = false;
                    }
                }
            }
        })
        .await;

        match result {
            Ok(r) => r,
            Err(_) => {
                // Kill the process to free resources; session will be recreated.
                let _ = self.child.kill().await;
                let _ = tokio::time::timeout(Duration::from_secs(5), self.child.wait()).await;
                Err(BashError(format!(
                    "Command timed out after {} seconds. Session has been reset.",
                    timeout.as_secs()
                )))
            }
        }
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub(crate) async fn kill(&mut self) {
        let _ = self.child.kill().await;
        let _ = tokio::time::timeout(Duration::from_secs(5), self.child.wait()).await;
    }

    /// Synchronous kill for use in app shutdown hooks where async is unavailable.
    pub(crate) fn kill_sync(&mut self) {
        if self.is_alive() {
            let _ = self.child.start_kill();
        }
    }

    fn make_marker(label: &str) -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();

        format!(
            "__CHATSHELL_{}_{:x}_{}_{}__",
            label,
            nanos,
            std::process::id(),
            seq
        )
    }
}

impl Drop for BashSession {
    fn drop(&mut self) {
        if self.is_alive() {
            let _ = self.child.start_kill();
        }
    }
}

// ---------------------------------------------------------------------------
// BashTool
// ---------------------------------------------------------------------------

/// Arguments for the bash tool
#[derive(Debug, Clone, Deserialize)]
pub struct BashArgs {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub workdir: Option<String>,
}

#[derive(Debug, thiserror::Error)]
#[error("Bash error: {0}")]
pub struct BashError(String);

/// Persistent-session bash tool.
///
/// Environment variables and working directory survive across calls.
/// The session is created lazily and recreated automatically on failure.
#[derive(Clone, Serialize, Deserialize)]
pub struct BashTool {
    #[serde(skip_serializing_if = "Option::is_none")]
    default_cwd: Option<String>,
    #[serde(skip)]
    session: SharedBashSession,
    #[serde(skip)]
    temp_files: TempFileList,
    #[serde(skip)]
    abort_notify: Option<Arc<tokio::sync::Notify>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<PathBuf>,
}

impl fmt::Debug for BashTool {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BashTool")
            .field("default_cwd", &self.default_cwd)
            .finish()
    }
}

impl Default for BashTool {
    fn default() -> Self {
        Self {
            default_cwd: None,
            session: Arc::new(TokioMutex::new(None)),
            temp_files: Arc::new(Mutex::new(Vec::new())),
            abort_notify: None,
            project_root: None,
        }
    }
}

impl BashTool {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_working_directory(cwd: String) -> Self {
        Self {
            default_cwd: Some(cwd),
            session: Arc::new(TokioMutex::new(None)),
            temp_files: Arc::new(Mutex::new(Vec::new())),
            abort_notify: None,
            project_root: None,
        }
    }

    pub fn with_session(session: SharedBashSession, cwd: Option<String>) -> Self {
        Self {
            default_cwd: cwd,
            session,
            temp_files: Arc::new(Mutex::new(Vec::new())),
            abort_notify: None,
            project_root: None,
        }
    }

    pub fn with_project_root(mut self, root: PathBuf) -> Self {
        self.project_root = Some(root);
        self
    }

    /// Set a shared temp file tracker (call before the tool is consumed by the agent builder).
    pub fn with_temp_file_tracker(mut self, tracker: TempFileList) -> Self {
        self.temp_files = tracker;
        self
    }

    /// Set the abort notification handle for cooperative cancellation.
    pub fn with_abort_notify(mut self, notify: Arc<tokio::sync::Notify>) -> Self {
        self.abort_notify = Some(notify);
        self
    }

    pub fn session_handle(&self) -> SharedBashSession {
        self.session.clone()
    }

    #[allow(dead_code)]
    pub fn temp_files_handle(&self) -> TempFileList {
        self.temp_files.clone()
    }

    fn resolve_cwd(&self) -> String {
        self.default_cwd
            .clone()
            .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
            .unwrap_or_else(|| ".".to_string())
    }

    /// Ensure `*guard` contains a live session, creating one if needed.
    async fn ensure_session(
        &self,
        guard: &mut tokio::sync::MutexGuard<'_, Option<BashSession>>,
    ) -> Result<(), BashError> {
        if let Some(ref mut s) = **guard {
            if s.is_alive() {
                return Ok(());
            }
            tracing::warn!("🖥️ [bash] Session died, creating a new one");
        }

        let cwd = self.resolve_cwd();
        tracing::info!("🖥️ [bash] Starting persistent session in: {}", cwd);
        **guard = Some(BashSession::new(&cwd).await?);
        Ok(())
    }

    fn check_dangerous(command: &str) -> Option<&'static str> {
        bash_security::check_dangerous(command)
    }

    /// Keep the first `TRUNCATE_HEAD_CHARS` and last `TRUNCATE_TAIL_CHARS`,
    /// replacing the middle with a summary line.
    /// When truncation occurs, saves the full output to a temp file and returns
    /// `(truncated_text, Some(temp_file_path))`.
    fn smart_truncate(output: &str) -> (String, Option<String>) {
        if output.len() <= MAX_OUTPUT_CHARS {
            return (output.to_string(), None);
        }

        let temp_path = Self::save_full_output_to_temp(output);

        let head_end = Self::char_boundary_at_or_before(output, TRUNCATE_HEAD_CHARS);
        let tail_start = Self::char_boundary_at_or_after(
            output,
            output.len().saturating_sub(TRUNCATE_TAIL_CHARS),
        );

        let truncated = if head_end >= tail_start {
            let end = Self::char_boundary_at_or_before(output, MAX_OUTPUT_CHARS);
            format!(
                "{}...\n[output truncated, {} chars total]",
                &output[..end],
                output.len()
            )
        } else {
            let omitted_lines = output[head_end..tail_start].lines().count();
            format!(
                "{}\n\n... [{} lines omitted, {} chars total] ...\n\n{}",
                output[..head_end].trim_end(),
                omitted_lines,
                output.len(),
                output[tail_start..].trim_start()
            )
        };

        (truncated, temp_path)
    }

    fn save_full_output_to_temp(output: &str) -> Option<String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let filename = format!("chatshell_bash_output_{:x}.txt", nanos);
        let path = std::env::temp_dir().join(filename);
        match std::fs::write(&path, output) {
            Ok(()) => {
                tracing::info!("🖥️ [bash] Full output saved to: {}", path.display());
                Some(path.to_string_lossy().to_string())
            }
            Err(e) => {
                tracing::warn!("🖥️ [bash] Failed to save full output: {}", e);
                None
            }
        }
    }

    /// Delete all temp files tracked by the given handle.
    pub fn cleanup_temp_files(handle: &TempFileList) {
        if let Ok(mut files) = handle.lock() {
            for path in files.drain(..) {
                if let Err(e) = std::fs::remove_file(&path) {
                    tracing::debug!(
                        "🧹 [bash] Failed to clean temp file {}: {}",
                        path.display(),
                        e
                    );
                }
            }
        }
    }

    fn char_boundary_at_or_before(s: &str, pos: usize) -> usize {
        let mut i = pos.min(s.len());
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
        i
    }

    fn char_boundary_at_or_after(s: &str, pos: usize) -> usize {
        let mut i = pos.min(s.len());
        while i < s.len() && !s.is_char_boundary(i) {
            i += 1;
        }
        i
    }
}

impl Tool for BashTool {
    const NAME: &'static str = "bash";

    type Error = BashError;
    type Args = BashArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        let cwd_note = if let Some(ref dir) = self.default_cwd {
            format!(" The session starts in: {}.", dir)
        } else {
            String::new()
        };

        ToolDefinition {
            name: "bash".to_string(),
            description: format!(
                "Execute a bash command in a persistent session. \
                 Environment variables and working directory persist between calls. \
                 Use `cd` to change directories. \
                 Returns combined stdout and stderr. \
                 Always prefer non-interactive commands (avoid commands that require user input).{cwd_note}"
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to execute"
                    },
                    "timeout": {
                        "type": "number",
                        "description": "Timeout in seconds (default: 120, max: 600)"
                    },
                    "description": {
                        "type": "string",
                        "description": "A concise (5-10 word) human-readable description of what the command does"
                    },
                    "workdir": {
                        "type": "string",
                        "description": "Working directory to run this command in. The command runs in a sub-shell so the session's cwd is not changed."
                    }
                },
                "required": ["command"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] bash: command={:?} timeout={:?} description={:?} workdir={:?}",
            args.command,
            args.timeout,
            args.description,
            args.workdir
        );

        let mut guard = self.session.lock().await;

        let command = args
            .command
            .as_deref()
            .filter(|c| !c.is_empty())
            .ok_or_else(|| BashError("No command provided".into()))?;

        // --- security checks (dangerous patterns + compound analysis + injection) ---
        let security_warning = match bash_security::check_command(command, Self::check_dangerous) {
            SecurityVerdict::Block(msg) => {
                tracing::warn!("🛡️ [bash] Command blocked: {}", command);
                return Err(BashError(msg));
            }
            SecurityVerdict::Warn(msg) => {
                tracing::warn!("🛡️ [bash] Security warning: {} — {}", msg, command);
                Some(msg)
            }
            SecurityVerdict::Allow => None,
        };

        // --- write-target boundary check (redirect targets + write commands) ---
        if let Err(msg) = bash_security::check_write_targets(
            command,
            self.project_root.as_deref(),
            self.default_cwd.as_deref(),
        ) {
            tracing::warn!("🛡️ [bash] Write target blocked: {} — {}", msg, command);
            return Err(BashError(msg));
        }

        // Wrap in a sub-shell if workdir is specified so the session's cwd is unaffected
        let effective_command = if let Some(ref dir) = args.workdir {
            format!("(cd '{}' && {})", dir.replace('\'', "'\\''"), command)
        } else {
            command.to_string()
        };

        // --- ensure session ---
        self.ensure_session(&mut guard).await?;

        let timeout_secs = args.timeout.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(1, 600);

        let session = guard.as_mut().unwrap();
        let result = if let Some(ref abort) = self.abort_notify {
            tokio::select! {
                biased;
                _ = abort.notified() => {
                    tracing::info!("🛑 [bash] Command aborted: generation was stopped");
                    if let Some(mut s) = guard.take() {
                        s.kill().await;
                    }
                    Err(BashError("Command aborted: generation was stopped.".into()))
                }
                r = session.execute(&effective_command, Duration::from_secs(timeout_secs)) => r,
            }
        } else {
            session
                .execute(&effective_command, Duration::from_secs(timeout_secs))
                .await
        };

        match result {
            Ok(cmd) => {
                tracing::info!(
                    "🔧 [tool-result] bash: exit_code={} output_len={}",
                    cmd.exit_code,
                    cmd.output.len()
                );

                let (text, temp_file) = Self::smart_truncate(cmd.output.trim_end());
                if let Some(ref path_str) = temp_file
                    && let Ok(mut files) = self.temp_files.lock()
                {
                    files.push(PathBuf::from(path_str));
                }
                let file_notice = temp_file
                    .map(|p| {
                        format!(
                            "\n[full output saved to {} -- use the read tool to view]",
                            p
                        )
                    })
                    .unwrap_or_default();

                let warn_prefix = security_warning
                    .as_ref()
                    .map(|w| format!("{}\n", w))
                    .unwrap_or_default();

                if cmd.exit_code == 0 {
                    if text.is_empty() {
                        Ok(format!("{}(no output)", warn_prefix))
                    } else {
                        Ok(format!("{}{}{}", warn_prefix, text, file_notice))
                    }
                } else if text.is_empty() {
                    Ok(format!(
                        "{}[exit code: {}]{}",
                        warn_prefix, cmd.exit_code, file_notice
                    ))
                } else {
                    Ok(format!(
                        "{}[exit code: {}]\n{}{}",
                        warn_prefix, cmd.exit_code, text, file_notice
                    ))
                }
            }
            Err(e) => {
                // Mark the session dead so it gets recreated next time.
                if let Some(ref mut s) = *guard
                    && !s.is_alive()
                {
                    tracing::warn!("🖥️ [bash] Session dead after error, will recreate");
                    *guard = None;
                }
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bash_tool_creation() {
        let tool = BashTool::new();
        assert_eq!(BashTool::NAME, "bash");
        let _ = tool;
    }

    #[test]
    fn test_bash_args_command_only() {
        let args: BashArgs = serde_json::from_str(r#"{"command": "echo hello"}"#).unwrap();
        assert_eq!(args.command, Some("echo hello".to_string()));
        assert_eq!(args.timeout, None);
    }

    #[test]
    fn test_bash_args_with_timeout() {
        let args: BashArgs =
            serde_json::from_str(r#"{"command": "sleep 5", "timeout": 10}"#).unwrap();
        assert_eq!(args.command, Some("sleep 5".to_string()));
        assert_eq!(args.timeout, Some(10));
    }

    #[test]
    fn test_bash_args_with_description() {
        let args: BashArgs = serde_json::from_str(
            r#"{"command": "ls -la", "description": "List directory contents"}"#,
        )
        .unwrap();
        assert_eq!(args.command, Some("ls -la".to_string()));
        assert_eq!(
            args.description,
            Some("List directory contents".to_string())
        );
    }

    #[test]
    fn test_dangerous_command_detection() {
        // Root-targeting commands
        assert!(BashTool::check_dangerous("rm -rf /").is_some());
        assert!(BashTool::check_dangerous("rm -rf /*").is_some());
        assert!(BashTool::check_dangerous("rm -fr /").is_some());
        assert!(BashTool::check_dangerous("rm -rf / && echo done").is_some());
        assert!(BashTool::check_dangerous("chmod -R 777 /").is_some());
        assert!(BashTool::check_dangerous("chmod -R 777 /*").is_some());

        // Other dangerous patterns
        assert!(BashTool::check_dangerous("sudo mkfs.ext4 /dev/sda1").is_some());
        assert!(BashTool::check_dangerous(":(){:|:&};:").is_some());

        // Safe commands (specific paths, not root)
        assert!(BashTool::check_dangerous("echo hello").is_none());
        assert!(BashTool::check_dangerous("ls -la").is_none());
        assert!(BashTool::check_dangerous("rm -rf /tmp/mydir").is_none());
        assert!(BashTool::check_dangerous("rm -rf /var/log/old").is_none());
        assert!(BashTool::check_dangerous("rm file.txt").is_none());
        assert!(BashTool::check_dangerous("chmod -R 777 /tmp").is_none());
    }

    #[test]
    fn test_smart_truncate_short() {
        let short = "hello world\n";
        let (result, temp) = BashTool::smart_truncate(short);
        assert_eq!(result, short);
        assert!(temp.is_none());
    }

    #[test]
    fn test_smart_truncate_long() {
        let long: String = (0..5000).map(|i| format!("line {}\n", i)).collect();
        let (result, temp) = BashTool::smart_truncate(&long);
        assert!(result.len() < long.len());
        assert!(result.contains("lines omitted"));
        assert!(result.contains("line 0"));
        assert!(result.contains("line 4999"));
        assert!(temp.is_some());
        // Clean up temp file
        if let Some(ref path) = temp {
            let _ = std::fs::remove_file(path);
        }
    }

    #[test]
    fn test_smart_truncate_preserves_char_boundaries() {
        let piece = "你好世界\n";
        let long: String = std::iter::repeat(piece).take(10_000).collect();
        let (result, temp) = BashTool::smart_truncate(&long);
        assert!(result.len() < long.len());
        if let Some(ref path) = temp {
            let _ = std::fs::remove_file(path);
        }
    }
}
