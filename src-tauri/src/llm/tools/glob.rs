//! Glob tool for LLM agents
//!
//! A file pattern matching tool modeled after Claude Code's Glob tool.
//! Uses the `ignore` crate for directory walking (respects .gitignore)
//! and returns results sorted by modification time (most recent first).

use ignore::WalkBuilder;
use ignore::overrides::OverrideBuilder;
use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use std::time::SystemTime;

const MAX_RESULTS: usize = 1000;
const MAX_COLLECT: usize = 100_000;
const GLOB_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Deserialize)]
pub struct GlobArgs {
    /// Glob pattern to match files (e.g. "**/*.rs", "src/**/*.tsx")
    pub pattern: String,
    /// Root directory to search from
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, thiserror::Error)]
#[error("Glob error: {0}")]
pub struct GlobError(String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GlobTool {
    #[serde(skip_serializing_if = "Option::is_none")]
    default_path: Option<String>,
}

impl GlobTool {
    pub fn new() -> Self {
        Self { default_path: None }
    }

    pub fn with_working_directory(path: String) -> Self {
        Self {
            default_path: Some(path),
        }
    }
}

impl Tool for GlobTool {
    const NAME: &'static str = "glob";

    type Error = GlobError;
    type Args = GlobArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        let path_description = if let Some(ref default_dir) = self.default_path {
            format!(
                "Root directory to search from (defaults to: {})",
                default_dir
            )
        } else {
            "Root directory to search from (defaults to home directory)".to_string()
        };

        ToolDefinition {
            name: "glob".to_string(),
            description: "Find files matching a glob pattern. \
                Returns a list of matching file paths sorted by modification time (most recent first). \
                Use this to discover files by name patterns, \
                find source files, configuration files, or any files \
                in a directory tree. Supports recursive patterns like **/*.rs. \
                Respects .gitignore rules automatically."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern to match files (e.g. \"**/*.rs\", \"src/**/*.tsx\", \"*.json\", \"*.config.{js,ts}\")"
                    },
                    "path": {
                        "type": "string",
                        "description": path_description
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

        let base_dir = args.path.or(self.default_path.clone()).unwrap_or_else(|| {
            dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string())
        });

        let pattern = args.pattern;

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(GLOB_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || run_glob(&pattern, &base_dir)),
        )
        .await
        .map_err(|_| {
            GlobError(format!(
                "Glob timed out after {}s (directory may be too large)",
                GLOB_TIMEOUT_SECS
            ))
        })?
        .map_err(|e| GlobError(format!("Glob task failed: {}", e)))?;

        result
    }
}

fn run_glob(pattern: &str, base_dir: &str) -> Result<String, GlobError> {
    let base_path = Path::new(base_dir);
    if !base_path.exists() {
        return Err(GlobError(format!("Directory not found: {}", base_dir)));
    }

    let mut walk_builder = WalkBuilder::new(base_dir);
    walk_builder.max_depth(Some(20));

    let mut override_builder = OverrideBuilder::new(base_dir);
    override_builder
        .add(pattern)
        .map_err(|e| GlobError(format!("Invalid glob pattern: {}", e)))?;
    let overrides = override_builder
        .build()
        .map_err(|e| GlobError(format!("Failed to build glob matcher: {}", e)))?;
    walk_builder.overrides(overrides);

    let mut entries: Vec<(String, SystemTime)> = Vec::new();

    for entry in walk_builder.build().flatten() {
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }

        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        let display_path = entry
            .path()
            .strip_prefix(base_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_string();
        entries.push((display_path, mtime));

        if entries.len() >= MAX_COLLECT {
            break;
        }
    }

    entries.sort_by(|a, b| b.1.cmp(&a.1));
    entries.truncate(MAX_RESULTS);

    if entries.is_empty() {
        return Ok("No files found matching the pattern.".to_string());
    }

    let total_collected = entries.len();
    let paths: Vec<&str> = entries.iter().map(|(p, _)| p.as_str()).collect();
    let mut output = paths.join("\n");

    if total_collected >= MAX_RESULTS {
        output.push_str(&format!(
            "\n\n... (results capped at {} files, relative to {})",
            MAX_RESULTS, base_dir
        ));
    } else {
        output.push_str(&format!(
            "\n\n({} files found, relative to {})",
            total_collected, base_dir
        ));
    }

    tracing::info!("🔧 [tool-result] glob: found {} files", total_collected);

    Ok(output)
}
