//! Write tool for LLM agents
//!
//! Creates new files or overwrites existing ones with provided content.
//! Automatically creates parent directories as needed.

use std::path::{Path, PathBuf};

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::path_policy;

#[derive(Debug, Clone, Deserialize)]
pub struct WriteArgs {
    /// Absolute path to the file to write
    pub path: String,
    /// Complete content to write to the file
    pub content: String,
}

#[derive(Debug, thiserror::Error)]
#[error("Write error: {0}")]
pub struct WriteError(String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WriteTool {
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<PathBuf>,
}

impl WriteTool {
    pub fn new() -> Self {
        Self { project_root: None }
    }

    pub fn with_project_root(root: PathBuf) -> Self {
        Self {
            project_root: Some(root),
        }
    }
}

impl Tool for WriteTool {
    const NAME: &'static str = "write";

    type Error = WriteError;
    type Args = WriteArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "write".to_string(),
            description: "Create a new file or overwrite an existing file with the given content. \
                Parent directories are created automatically if they don't exist. \
                For modifying existing files prefer the `edit` tool over `write`, \
                as `edit` makes targeted changes while `write` replaces the entire file. \
                Use `write` for creating new files or when the entire content needs to be replaced."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file to write"
                    },
                    "content": {
                        "type": "string",
                        "description": "The complete content to write to the file"
                    }
                },
                "required": ["path", "content"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] write: path=\"{}\" content_len={}",
            args.path,
            args.content.len()
        );

        let path = Path::new(&args.path);

        path_policy::check_write(path, self.project_root.as_deref()).map_err(|e| WriteError(e))?;

        // Create parent directories if needed
        if let Some(parent) = path.parent()
            && !parent.exists()
        {
            std::fs::create_dir_all(parent)
                .map_err(|e| WriteError(format!("Failed to create directories: {}", e)))?;
        }

        let is_new = !path.exists();

        std::fs::write(path, &args.content)
            .map_err(|e| WriteError(format!("Failed to write file: {}", e)))?;

        let line_count = args.content.lines().count();
        let action = if is_new { "Created" } else { "Wrote" };

        tracing::info!(
            "🔧 [tool-result] write: {} \"{}\" ({} lines, {} bytes)",
            action.to_lowercase(),
            args.path,
            line_count,
            args.content.len()
        );

        Ok(format!(
            "{} {} ({} lines, {} bytes)",
            action,
            args.path,
            line_count,
            args.content.len()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_tool_creation() {
        let tool = WriteTool::new();
        assert_eq!(WriteTool::NAME, "write");
        let _ = tool;
    }

    #[test]
    fn test_write_args() {
        let args: WriteArgs =
            serde_json::from_str(r#"{"path": "/tmp/test.txt", "content": "hello\nworld"}"#)
                .unwrap();
        assert_eq!(args.path, "/tmp/test.txt");
        assert_eq!(args.content, "hello\nworld");
    }
}
