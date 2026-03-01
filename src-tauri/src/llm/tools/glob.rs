//! Glob tool for LLM agents
//!
//! A file pattern matching tool modeled after Claude Code's Glob tool.
//! Uses the `glob` crate for fast filesystem pattern matching.

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;

const MAX_RESULTS: usize = 1000;

/// Arguments for the glob tool
#[derive(Debug, Clone, Deserialize)]
pub struct GlobArgs {
    /// Glob pattern to match files (e.g. "**/*.rs", "src/**/*.tsx")
    pub pattern: String,
    /// Root directory to search from (defaults to home directory)
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, thiserror::Error)]
#[error("Glob error: {0}")]
pub struct GlobError(String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GlobTool;

impl GlobTool {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for GlobTool {
    const NAME: &'static str = "glob";

    type Error = GlobError;
    type Args = GlobArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "glob".to_string(),
            description: "Find files matching a glob pattern. \
                Returns a list of matching file paths. \
                Use this to discover files by name patterns, \
                find source files, configuration files, or any files \
                in a directory tree. Supports recursive patterns like **/*.rs."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern to match files (e.g. \"**/*.rs\", \"src/**/*.tsx\", \"*.json\")"
                    },
                    "path": {
                        "type": "string",
                        "description": "Root directory to search from. Defaults to home directory."
                    }
                },
                "required": ["pattern"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] glob: pattern=\"{}\" path={:?}",
            args.pattern,
            args.path
        );

        let base_dir = args.path.unwrap_or_else(|| {
            dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string())
        });

        let base_path = std::path::Path::new(&base_dir);
        if !base_path.exists() {
            return Err(GlobError(format!("Directory not found: {}", base_dir)));
        }

        // Build the full pattern by joining base_dir and the pattern
        let full_pattern = if args.pattern.starts_with('/') {
            args.pattern.clone()
        } else {
            format!("{}/{}", base_dir.trim_end_matches('/'), args.pattern)
        };

        let options = glob::MatchOptions {
            case_sensitive: true,
            require_literal_separator: false,
            require_literal_leading_dot: true,
        };

        let entries = glob::glob_with(&full_pattern, options)
            .map_err(|e| GlobError(format!("Invalid glob pattern: {}", e)))?;

        let mut results = Vec::new();
        for entry in entries {
            match entry {
                Ok(path) => {
                    results.push(path.to_string_lossy().to_string());
                    if results.len() >= MAX_RESULTS {
                        break;
                    }
                }
                Err(e) => {
                    tracing::debug!("🔧 [glob] Skipping entry: {}", e);
                }
            }
        }

        if results.is_empty() {
            return Ok("No files found matching the pattern.".to_string());
        }

        let truncated = results.len() >= MAX_RESULTS;
        let mut output = results.join("\n");

        if truncated {
            output.push_str(&format!(
                "\n\n... (results capped at {} files)",
                MAX_RESULTS
            ));
        } else {
            output.push_str(&format!("\n\n({} files found)", results.len()));
        }

        tracing::info!("🔧 [tool-result] glob: found {} files", results.len());

        Ok(output)
    }
}
