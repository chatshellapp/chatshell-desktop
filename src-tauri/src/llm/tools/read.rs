//! Read tool for LLM agents
//!
//! A general-purpose file reading tool modeled after Claude Code's Read tool.
//! Allows the AI to read any text file from the filesystem.

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;

const DEFAULT_LINE_LIMIT: usize = 2000;
const MAX_LINE_LENGTH: usize = 2000;
const BINARY_CHECK_SIZE: usize = 8192;

/// Arguments for the read tool
#[derive(Debug, Clone, Deserialize)]
pub struct ReadArgs {
    /// Absolute path to the file to read
    pub path: String,
    /// Line number to start reading from (1-indexed). Defaults to 1.
    #[serde(default)]
    pub offset: Option<usize>,
    /// Number of lines to read. Defaults to 2000.
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, thiserror::Error)]
#[error("Read error: {0}")]
pub struct ReadError(String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReadTool;

impl ReadTool {
    pub fn new() -> Self {
        Self
    }
}

impl Tool for ReadTool {
    const NAME: &'static str = "read";

    type Error = ReadError;
    type Args = ReadArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "read".to_string(),
            description: "Read the contents of a text file from the filesystem. \
                Returns file content with line numbers. \
                Use this to read source code, configuration files, documentation, \
                skill files (SKILL.md), or any other text file. \
                Supports reading specific line ranges for large files."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file to read"
                    },
                    "offset": {
                        "type": "number",
                        "description": "Line number to start reading from (1-indexed). Defaults to 1."
                    },
                    "limit": {
                        "type": "number",
                        "description": "Maximum number of lines to read. Defaults to 2000."
                    }
                },
                "required": ["path"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] read: path=\"{}\" offset={:?} limit={:?}",
            args.path,
            args.offset,
            args.limit
        );

        let path = std::path::Path::new(&args.path);
        if !path.exists() {
            return Err(ReadError(format!("File not found: {}", args.path)));
        }
        if !path.is_file() {
            return Err(ReadError(format!("Not a file: {}", args.path)));
        }

        // Check for binary content by reading the first chunk
        let raw_bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => return Err(ReadError(format!("Failed to read file: {}", e))),
        };

        let check_len = raw_bytes.len().min(BINARY_CHECK_SIZE);
        if raw_bytes[..check_len].contains(&0) {
            return Err(ReadError(format!(
                "Binary file detected, cannot read: {}",
                args.path
            )));
        }

        let content = match String::from_utf8(raw_bytes) {
            Ok(s) => s,
            Err(_) => {
                return Err(ReadError(format!("File is not valid UTF-8: {}", args.path)));
            }
        };

        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();

        let offset = args.offset.unwrap_or(1).max(1);
        let limit = args.limit.unwrap_or(DEFAULT_LINE_LIMIT);

        let start_idx = (offset - 1).min(total_lines);
        let end_idx = (start_idx + limit).min(total_lines);
        let selected = &lines[start_idx..end_idx];

        let mut output = String::new();

        for (i, line) in selected.iter().enumerate() {
            let line_num = start_idx + i + 1;
            let display_line = if line.len() > MAX_LINE_LENGTH {
                format!("{}... (truncated)", &line[..MAX_LINE_LENGTH])
            } else {
                line.to_string()
            };
            output.push_str(&format!("{:>6}\t{}\n", line_num, display_line));
        }

        if end_idx < total_lines {
            output.push_str(&format!(
                "\n... ({} more lines, {} total)",
                total_lines - end_idx,
                total_lines
            ));
        }

        tracing::info!(
            "🔧 [tool-result] read: returned {} lines from \"{}\" (total: {})",
            selected.len(),
            args.path,
            total_lines
        );

        Ok(output)
    }
}
