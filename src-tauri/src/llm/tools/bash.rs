//! Bash tool for LLM agents
//!
//! Allows the AI to execute bash commands on the user's system.
//! This enables skills that require CLI tools (e.g., `memo` for Apple Notes).

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::process::Stdio;
use tokio::process::Command;

/// Maximum output length to prevent overwhelming the LLM context
const MAX_OUTPUT_CHARS: usize = 50000;

/// Default command timeout in seconds
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Arguments for the bash tool
#[derive(Debug, Clone, Deserialize)]
pub struct BashArgs {
    /// The bash command to execute
    pub command: String,
    /// Working directory for the command (defaults to user's home directory)
    #[serde(default)]
    pub cwd: Option<String>,
    /// Timeout in seconds (default: 30)
    #[serde(default)]
    pub timeout: Option<u64>,
}

/// Error type for bash tool
#[derive(Debug, thiserror::Error)]
#[error("Bash error: {0}")]
pub struct BashError(String);

/// Bash tool implementation
///
/// This tool allows the AI agent to execute bash commands on the host system.
/// It captures both stdout and stderr and returns them formatted for LLM consumption.
///
/// Security considerations:
/// - Commands run with the user's permissions
/// - A timeout is enforced to prevent runaway processes
/// - Output is truncated to prevent context overflow
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BashTool {
    /// Default working directory for commands when not specified by the LLM.
    /// If None, falls back to the user's home directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    default_cwd: Option<String>,
}

impl BashTool {
    pub fn new() -> Self {
        Self { default_cwd: None }
    }

    /// Create a BashTool with a configured default working directory
    pub fn with_working_directory(cwd: String) -> Self {
        Self {
            default_cwd: Some(cwd),
        }
    }
}

impl Tool for BashTool {
    const NAME: &'static str = "bash";

    type Error = BashError;
    type Args = BashArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        let cwd_description = if let Some(ref default_dir) = self.default_cwd {
            format!(
                "Working directory for the command (defaults to: {})",
                default_dir
            )
        } else {
            "Working directory for the command (defaults to user's home directory)".to_string()
        };

        ToolDefinition {
            name: "bash".to_string(),
            description: "Execute a bash command on the user's system. \
                Returns the command's stdout and stderr output. \
                Use this to run CLI tools, scripts, file operations, or any shell command. \
                The command runs with the user's permissions. \
                Always prefer non-interactive commands (avoid commands that require user input)."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to execute"
                    },
                    "cwd": {
                        "type": "string",
                        "description": cwd_description
                    },
                    "timeout": {
                        "type": "number",
                        "description": "Timeout in seconds (default: 30, max: 300)"
                    }
                },
                "required": ["command"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] bash: command=\"{}\" cwd={:?} timeout={:?}",
            args.command,
            args.cwd,
            args.timeout
        );

        // Determine working directory:
        // 1. LLM-specified cwd (from tool call args)
        // 2. Configured default_cwd (from conversation settings)
        // 3. User's home directory
        // 4. Current directory as last resort
        let cwd = args
            .cwd
            .or_else(|| self.default_cwd.clone())
            .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
            .unwrap_or_else(|| ".".to_string());

        // Clamp timeout between 1 and 300 seconds
        let timeout_secs = args.timeout.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(1, 300);

        // Build the command
        let mut cmd = Command::new("bash");
        cmd.arg("-c")
            .arg(&args.command)
            .current_dir(&cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Prevent the child from inheriting stdin to avoid interactive hangs
            .stdin(Stdio::null());

        // Execute with timeout
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), cmd.output()).await;

        match result {
            Ok(Ok(output)) => {
                let exit_code = output.status.code().unwrap_or(-1);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                // Format output for LLM consumption
                let mut formatted = format!("## Bash Command Result\n\n");
                formatted.push_str(&format!("**Command:** `{}`\n", args.command));
                formatted.push_str(&format!("**Working Directory:** `{}`\n", cwd));
                formatted.push_str(&format!("**Exit Code:** {}\n\n", exit_code));

                if !stdout.is_empty() {
                    let stdout_str = if stdout.len() > MAX_OUTPUT_CHARS {
                        format!(
                            "{}...\n\n*[Output truncated at {} characters]*",
                            &stdout[..MAX_OUTPUT_CHARS],
                            MAX_OUTPUT_CHARS
                        )
                    } else {
                        stdout.to_string()
                    };
                    formatted.push_str("### stdout\n\n```\n");
                    formatted.push_str(&stdout_str);
                    formatted.push_str("\n```\n\n");
                }

                if !stderr.is_empty() {
                    let stderr_str = if stderr.len() > MAX_OUTPUT_CHARS {
                        format!(
                            "{}...\n\n*[Error output truncated at {} characters]*",
                            &stderr[..MAX_OUTPUT_CHARS],
                            MAX_OUTPUT_CHARS
                        )
                    } else {
                        stderr.to_string()
                    };
                    formatted.push_str("### stderr\n\n```\n");
                    formatted.push_str(&stderr_str);
                    formatted.push_str("\n```\n\n");
                }

                if stdout.is_empty() && stderr.is_empty() {
                    formatted.push_str("*No output produced.*\n");
                }

                tracing::info!(
                    "🔧 [tool-result] bash: exit_code={} stdout_len={} stderr_len={}",
                    exit_code,
                    stdout.len(),
                    stderr.len()
                );

                Ok(formatted)
            }
            Ok(Err(e)) => {
                tracing::error!("🔧 [tool-error] bash: failed to execute: {}", e);
                Err(BashError(format!("Failed to execute command: {}", e)))
            }
            Err(_) => {
                tracing::warn!(
                    "🔧 [tool-error] bash: command timed out after {}s",
                    timeout_secs
                );
                Err(BashError(format!(
                    "Command timed out after {} seconds",
                    timeout_secs
                )))
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
        let _ = tool; // Just verify it can be created
    }

    #[test]
    fn test_bash_args_deserialization() {
        let args: BashArgs = serde_json::from_str(r#"{"command": "echo hello"}"#).unwrap();
        assert_eq!(args.command, "echo hello");
        assert_eq!(args.cwd, None);
        assert_eq!(args.timeout, None);
    }

    #[test]
    fn test_bash_args_with_all_fields() {
        let args: BashArgs =
            serde_json::from_str(r#"{"command": "ls -la", "cwd": "/tmp", "timeout": 10}"#).unwrap();
        assert_eq!(args.command, "ls -la");
        assert_eq!(args.cwd, Some("/tmp".to_string()));
        assert_eq!(args.timeout, Some(10));
    }
}
