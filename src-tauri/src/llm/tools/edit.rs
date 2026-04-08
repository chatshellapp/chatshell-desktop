//! Edit tool for LLM agents
//!
//! Provides precise string replacement in files. The LLM specifies an exact
//! `old_string` to find and a `new_string` to replace it with. Supports
//! `replace_all` for renaming variables across a file.

use std::path::{Path, PathBuf};

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::path_policy;

#[derive(Debug, Clone, Deserialize)]
pub struct EditArgs {
    /// Absolute path to the file to edit
    pub path: String,
    /// The exact text to find and replace (must be unique unless replace_all is true)
    pub old_string: String,
    /// The replacement text (must differ from old_string)
    pub new_string: String,
    /// Replace all occurrences instead of requiring uniqueness (default: false)
    #[serde(default)]
    pub replace_all: Option<bool>,
}

#[derive(Debug, thiserror::Error)]
#[error("Edit error: {0}")]
pub struct EditError(String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EditTool {
    #[serde(skip_serializing_if = "Option::is_none")]
    project_root: Option<PathBuf>,
}

impl EditTool {
    pub fn new() -> Self {
        Self { project_root: None }
    }

    pub fn with_project_root(root: PathBuf) -> Self {
        Self {
            project_root: Some(root),
        }
    }
}

impl Tool for EditTool {
    const NAME: &'static str = "edit";

    type Error = EditError;
    type Args = EditArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "edit".to_string(),
            description: "Make precise text replacements in a file. \
                Specify the exact text to find (old_string) and its replacement (new_string). \
                The old_string must match the file content exactly, including whitespace and indentation. \
                By default old_string must appear exactly once in the file; use replace_all to change every occurrence. \
                Always use the `read` tool first to see the current file content before editing."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file to edit"
                    },
                    "old_string": {
                        "type": "string",
                        "description": "The exact text to find in the file. Must match including whitespace and indentation."
                    },
                    "new_string": {
                        "type": "string",
                        "description": "The text to replace old_string with. Must differ from old_string."
                    },
                    "replace_all": {
                        "type": "boolean",
                        "description": "If true, replace all occurrences. If false (default), old_string must appear exactly once."
                    }
                },
                "required": ["path", "old_string", "new_string"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let replace_all = args.replace_all.unwrap_or(false);

        tracing::info!(
            "🔧 [tool-call] edit: path=\"{}\" old_len={} new_len={} replace_all={}",
            args.path,
            args.old_string.len(),
            args.new_string.len(),
            replace_all
        );

        if args.old_string == args.new_string {
            return Err(EditError(
                "old_string and new_string are identical; nothing to change".into(),
            ));
        }

        let path = Path::new(&args.path);

        path_policy::check_write(path, self.project_root.as_deref()).map_err(|e| EditError(e))?;

        if !path.exists() {
            return Err(EditError(format!("File not found: {}", args.path)));
        }
        if !path.is_file() {
            return Err(EditError(format!("Not a file: {}", args.path)));
        }

        let content = std::fs::read_to_string(path)
            .map_err(|e| EditError(format!("Failed to read file: {}", e)))?;

        let count = content.matches(&args.old_string).count();

        if count == 0 {
            return Err(EditError(format!(
                "old_string not found in {}. Make sure it matches the file content exactly, \
                 including whitespace and indentation. Use the `read` tool to check the current content.",
                args.path
            )));
        }

        if !replace_all && count > 1 {
            return Err(EditError(format!(
                "old_string appears {} times in {}. Provide more surrounding context to make it unique, \
                 or set replace_all to true.",
                count, args.path
            )));
        }

        let new_content = if replace_all {
            content.replace(&args.old_string, &args.new_string)
        } else {
            content.replacen(&args.old_string, &args.new_string, 1)
        };

        std::fs::write(path, &new_content)
            .map_err(|e| EditError(format!("Failed to write file: {}", e)))?;

        let replacements = if replace_all { count } else { 1 };

        tracing::info!(
            "🔧 [tool-result] edit: replaced {} occurrence(s) in \"{}\"",
            replacements,
            args.path
        );

        Ok(format!(
            "Successfully replaced {} occurrence(s) in {}",
            replacements, args.path
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_edit_tool_creation() {
        let tool = EditTool::new();
        assert_eq!(EditTool::NAME, "edit");
        let _ = tool;
    }

    #[test]
    fn test_edit_args_basic() {
        let args: EditArgs = serde_json::from_str(
            r#"{"path": "/tmp/test.rs", "old_string": "foo", "new_string": "bar"}"#,
        )
        .unwrap();
        assert_eq!(args.path, "/tmp/test.rs");
        assert_eq!(args.old_string, "foo");
        assert_eq!(args.new_string, "bar");
        assert_eq!(args.replace_all, None);
    }

    #[test]
    fn test_edit_args_with_replace_all() {
        let args: EditArgs = serde_json::from_str(
            r#"{"path": "/tmp/test.rs", "old_string": "foo", "new_string": "bar", "replace_all": true}"#,
        )
        .unwrap();
        assert_eq!(args.replace_all, Some(true));
    }
}
