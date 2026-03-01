//! Grep tool for LLM agents
//!
//! A content search tool modeled after Claude Code's Grep tool.
//! Wraps ripgrep (`rg`) for fast regex searching across files.

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::process::Stdio;
use tokio::process::Command;

const MAX_OUTPUT_CHARS: usize = 50000;

/// Arguments for the grep tool
#[derive(Debug, Clone, Deserialize)]
pub struct GrepArgs {
    /// Regular expression pattern to search for
    pub pattern: String,
    /// File or directory path to search in (defaults to home directory)
    #[serde(default)]
    pub path: Option<String>,
    /// Glob pattern to filter files (e.g. "*.rs", "*.tsx")
    #[serde(default)]
    pub glob: Option<String>,
    /// Case-insensitive search
    #[serde(default)]
    pub case_insensitive: Option<bool>,
    /// Number of context lines around each match
    #[serde(default)]
    pub context_lines: Option<usize>,
    /// Maximum number of matches to return
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Debug, thiserror::Error)]
#[error("Grep error: {0}")]
pub struct GrepError(String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GrepTool;

impl GrepTool {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for GrepTool {
    const NAME: &'static str = "grep";

    type Error = GrepError;
    type Args = GrepArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "grep".to_string(),
            description: "Search file contents using regular expressions. \
                Returns matching lines with file paths and line numbers. \
                Use this to find code patterns, function definitions, variable usage, \
                error messages, or any text across a codebase. \
                Powered by ripgrep for fast searching."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regular expression pattern to search for"
                    },
                    "path": {
                        "type": "string",
                        "description": "File or directory to search in. Defaults to home directory."
                    },
                    "glob": {
                        "type": "string",
                        "description": "Glob pattern to filter files (e.g. \"*.rs\", \"*.tsx\")"
                    },
                    "case_insensitive": {
                        "type": "boolean",
                        "description": "Enable case-insensitive search. Defaults to false."
                    },
                    "context_lines": {
                        "type": "number",
                        "description": "Number of context lines to show around each match"
                    },
                    "max_results": {
                        "type": "number",
                        "description": "Maximum number of matches to return"
                    }
                },
                "required": ["pattern"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] grep: pattern=\"{}\" path={:?} glob={:?}",
            args.pattern,
            args.path,
            args.glob
        );

        let search_path = args.path.clone().unwrap_or_else(|| {
            dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string())
        });

        // Try ripgrep first, fall back to grep
        let result = run_ripgrep(&args.pattern, &search_path, &args).await;
        match result {
            Ok(output) => Ok(output),
            Err(_) => run_system_grep(&args.pattern, &search_path, &args).await,
        }
    }
}

async fn run_ripgrep(
    pattern: &str,
    search_path: &str,
    args: &GrepArgs,
) -> Result<String, GrepError> {
    let mut cmd = Command::new("rg");
    cmd.arg("--line-number")
        .arg("--no-heading")
        .arg("--color=never");

    if args.case_insensitive.unwrap_or(false) {
        cmd.arg("--case-insensitive");
    }

    if let Some(ctx) = args.context_lines {
        cmd.arg(format!("-C{}", ctx));
    }

    if let Some(max) = args.max_results {
        cmd.arg(format!("-m{}", max));
    }

    if let Some(ref glob) = args.glob {
        cmd.arg("--glob").arg(glob);
    }

    cmd.arg(pattern).arg(search_path);

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| GrepError(format!("Failed to execute rg: {}", e)))?;

    // rg exit code 1 = no matches (not an error), 2+ = actual error
    if output.status.code() == Some(2) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GrepError(format!("ripgrep error: {}", stderr)));
    }

    let mut result = String::from_utf8_lossy(&output.stdout).to_string();

    if result.is_empty() {
        return Ok("No matches found.".to_string());
    }

    if result.len() > MAX_OUTPUT_CHARS {
        result.truncate(MAX_OUTPUT_CHARS);
        result.push_str("\n\n... (output truncated)");
    }

    tracing::info!("🔧 [tool-result] grep: {} chars of results", result.len());

    Ok(result)
}

async fn run_system_grep(
    pattern: &str,
    search_path: &str,
    args: &GrepArgs,
) -> Result<String, GrepError> {
    let mut cmd = Command::new("grep");
    cmd.arg("-rn").arg("--color=never");

    if args.case_insensitive.unwrap_or(false) {
        cmd.arg("-i");
    }

    if let Some(ctx) = args.context_lines {
        cmd.arg(format!("-C{}", ctx));
    }

    if let Some(max) = args.max_results {
        cmd.arg(format!("-m{}", max));
    }

    if let Some(ref glob) = args.glob {
        cmd.arg("--include").arg(glob);
    }

    cmd.arg(pattern).arg(search_path);

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| GrepError(format!("Failed to execute grep: {}", e)))?;

    // grep exit code 1 = no matches
    let mut result = String::from_utf8_lossy(&output.stdout).to_string();

    if result.is_empty() {
        return Ok("No matches found.".to_string());
    }

    if result.len() > MAX_OUTPUT_CHARS {
        result.truncate(MAX_OUTPUT_CHARS);
        result.push_str("\n\n... (output truncated)");
    }

    tracing::info!(
        "🔧 [tool-result] grep (fallback): {} chars of results",
        result.len()
    );

    Ok(result)
}
