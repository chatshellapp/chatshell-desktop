//! Grep tool for LLM agents
//!
//! A content search tool powered by ripgrep's core crates (grep-regex, grep-searcher, ignore).
//! Performs fast, in-process regex searching without requiring external binaries.

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkContext, SinkMatch};
use ignore::WalkBuilder;
use ignore::overrides::OverrideBuilder;
use ignore::types::TypesBuilder;
use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fmt::Write;
use std::path::Path;

const MAX_OUTPUT_CHARS: usize = 50_000;
const SEARCH_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Deserialize)]
pub struct GrepArgs {
    pub pattern: String,
    #[serde(default)]
    pub path: Option<String>,
    /// Glob pattern to filter files (e.g. "*.rs", "*.{ts,tsx}")
    #[serde(default)]
    pub glob: Option<String>,
    /// File type to filter by (e.g. "rust", "js", "py"). Uses ripgrep's built-in type definitions.
    #[serde(default)]
    pub file_type: Option<String>,
    #[serde(default)]
    pub case_insensitive: Option<bool>,
    /// Enable multiline matching (`.` matches `\n`, patterns can span lines)
    #[serde(default)]
    pub multiline: Option<bool>,
    /// Context lines around each match (sets both before and after)
    #[serde(default)]
    pub context_lines: Option<usize>,
    /// Lines to show before each match (overrides context_lines for before)
    #[serde(default)]
    pub before_context: Option<usize>,
    /// Lines to show after each match (overrides context_lines for after)
    #[serde(default)]
    pub after_context: Option<usize>,
    /// Maximum total number of matches to return across all files
    #[serde(default)]
    pub head_limit: Option<usize>,
    /// "content" (default), "files_with_matches", or "count"
    #[serde(default)]
    pub output_mode: Option<String>,
}

#[derive(Debug, thiserror::Error)]
#[error("Grep error: {0}")]
pub struct GrepError(String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GrepTool {
    #[serde(skip_serializing_if = "Option::is_none")]
    default_path: Option<String>,
}

impl GrepTool {
    pub fn new() -> Self {
        Self { default_path: None }
    }

    pub fn with_working_directory(path: String) -> Self {
        Self {
            default_path: Some(path),
        }
    }
}

impl Tool for GrepTool {
    const NAME: &'static str = "grep";

    type Error = GrepError;
    type Args = GrepArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        let path_description = if let Some(ref default_dir) = self.default_path {
            format!(
                "File or directory to search in (defaults to: {})",
                default_dir
            )
        } else {
            "File or directory to search in (defaults to home directory)".to_string()
        };

        ToolDefinition {
            name: "grep".to_string(),
            description: "Search file contents using regular expressions. \
                Returns matching lines with file paths and line numbers. \
                Supports multiple output modes, file type filtering, multiline matching, \
                and context lines. Powered by ripgrep's core engine for fast in-process searching."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regular expression pattern to search for. Uses ripgrep syntax (not grep). Literal braces need escaping."
                    },
                    "path": {
                        "type": "string",
                        "description": path_description
                    },
                    "glob": {
                        "type": "string",
                        "description": "Glob pattern to filter files (e.g. \"*.rs\", \"*.{ts,tsx}\")"
                    },
                    "file_type": {
                        "type": "string",
                        "description": "File type to search (e.g. \"rust\", \"js\", \"py\", \"ts\", \"go\", \"java\", \"cpp\"). More efficient than glob for standard file types."
                    },
                    "case_insensitive": {
                        "type": "boolean",
                        "description": "Enable case-insensitive search. Defaults to false."
                    },
                    "multiline": {
                        "type": "boolean",
                        "description": "Enable multiline matching where . matches newlines and patterns can span lines. Defaults to false."
                    },
                    "context_lines": {
                        "type": "number",
                        "description": "Number of context lines to show before and after each match"
                    },
                    "before_context": {
                        "type": "number",
                        "description": "Number of lines to show before each match (overrides context_lines)"
                    },
                    "after_context": {
                        "type": "number",
                        "description": "Number of lines to show after each match (overrides context_lines)"
                    },
                    "head_limit": {
                        "type": "number",
                        "description": "Maximum total number of matches to return across all files"
                    },
                    "output_mode": {
                        "type": "string",
                        "enum": ["content", "files_with_matches", "count"],
                        "description": "Output mode: \"content\" shows matching lines with context (default), \"files_with_matches\" shows only file paths containing matches, \"count\" shows match counts per file"
                    }
                },
                "required": ["pattern"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] grep: pattern=\"{}\" path={:?} glob={:?} type={:?} mode={:?}",
            args.pattern,
            args.path,
            args.glob,
            args.file_type,
            args.output_mode
        );

        let search_path = args
            .path
            .clone()
            .or(self.default_path.clone())
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| ".".to_string())
            });

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || run_search(&args, &search_path)),
        )
        .await
        .map_err(|_| {
            GrepError(format!(
                "Search timed out after {}s (search scope may be too large)",
                SEARCH_TIMEOUT_SECS
            ))
        })?
        .map_err(|e| GrepError(format!("Search task failed: {}", e)))?;

        result
    }
}

// ---------------------------------------------------------------------------
// Core search logic (runs on a blocking thread)
// ---------------------------------------------------------------------------

fn run_search(args: &GrepArgs, search_path: &str) -> Result<String, GrepError> {
    let mut matcher_builder = RegexMatcherBuilder::new();
    if args.case_insensitive.unwrap_or(false) {
        matcher_builder.case_insensitive(true);
    }
    if args.multiline.unwrap_or(false) {
        matcher_builder.multi_line(true);
        matcher_builder.dot_matches_new_line(true);
    }

    let matcher = matcher_builder
        .build(&args.pattern)
        .map_err(|e| GrepError(format!("Invalid regex pattern: {}", e)))?;

    let mut searcher_builder = SearcherBuilder::new();
    searcher_builder.line_number(true);
    searcher_builder.binary_detection(BinaryDetection::quit(b'\x00'));

    if args.multiline.unwrap_or(false) {
        searcher_builder.multi_line(true);
    }

    let before = args.before_context.or(args.context_lines).unwrap_or(0);
    let after = args.after_context.or(args.context_lines).unwrap_or(0);
    if before > 0 {
        searcher_builder.before_context(before);
    }
    if after > 0 {
        searcher_builder.after_context(after);
    }

    let mut searcher = searcher_builder.build();
    let output_mode = args.output_mode.as_deref().unwrap_or("content");
    let head_limit = args.head_limit.unwrap_or(usize::MAX);
    let path = Path::new(search_path);

    if !path.exists() {
        return Err(GrepError(format!("Path not found: {}", search_path)));
    }

    let mut output = String::new();
    let mut total_matches: usize = 0;

    if path.is_file() {
        search_file(
            &matcher,
            &mut searcher,
            path,
            output_mode,
            &mut output,
            &mut total_matches,
            head_limit,
        );
    } else {
        let mut walk_builder = WalkBuilder::new(search_path);

        if let Some(ref file_type) = args.file_type {
            let mut types_builder = TypesBuilder::new();
            types_builder.add_defaults();
            types_builder.select(file_type);
            let types = types_builder
                .build()
                .map_err(|e| GrepError(format!("Failed to build type matcher: {}", e)))?;
            walk_builder.types(types);
        }

        if let Some(ref glob_pat) = args.glob {
            let mut override_builder = OverrideBuilder::new(search_path);
            override_builder
                .add(glob_pat)
                .map_err(|e| GrepError(format!("Invalid glob pattern: {}", e)))?;
            let overrides = override_builder
                .build()
                .map_err(|e| GrepError(format!("Failed to build glob override: {}", e)))?;
            walk_builder.overrides(overrides);
        }

        for entry in walk_builder.build().flatten() {
            if total_matches >= head_limit || output.len() > MAX_OUTPUT_CHARS {
                break;
            }
            if !entry.file_type().is_some_and(|ft| ft.is_file()) {
                continue;
            }
            search_file(
                &matcher,
                &mut searcher,
                entry.path(),
                output_mode,
                &mut output,
                &mut total_matches,
                head_limit,
            );
        }
    }

    if output.is_empty() {
        return Ok("No matches found.".to_string());
    }

    if output.len() > MAX_OUTPUT_CHARS {
        output.truncate(MAX_OUTPUT_CHARS);
        output.push_str("\n\n... (output truncated)");
    }

    tracing::info!(
        "🔧 [tool-result] grep: {} matches, {} chars",
        total_matches,
        output.len()
    );

    Ok(output)
}

fn search_file(
    matcher: &grep_regex::RegexMatcher,
    searcher: &mut Searcher,
    path: &Path,
    output_mode: &str,
    output: &mut String,
    total_matches: &mut usize,
    head_limit: usize,
) {
    let path_display = path.to_string_lossy();

    match output_mode {
        "files_with_matches" => {
            let mut found = false;
            let _ = searcher.search_path(matcher, path, FileMatchSink { found: &mut found });
            if found {
                let _ = writeln!(output, "{}", path_display);
                *total_matches += 1;
            }
        }
        "count" => {
            let mut count: u64 = 0;
            let _ = searcher.search_path(matcher, path, CountSink { count: &mut count });
            if count > 0 {
                let _ = writeln!(output, "{}:{}", path_display, count);
                *total_matches += count as usize;
            }
        }
        _ => {
            let _ = searcher.search_path(
                matcher,
                path,
                ContentSink {
                    path: &path_display,
                    output,
                    total_matches,
                    head_limit,
                    needs_separator: false,
                    had_output: false,
                },
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Sink implementations
// ---------------------------------------------------------------------------

/// Collects matching lines with file paths, line numbers, and context.
/// Output format matches ripgrep's `--no-heading --color=never` style:
///   match:   `filepath:linenum:content`
///   context: `filepath-linenum-content`
///   group separator: `--`
struct ContentSink<'a> {
    path: &'a str,
    output: &'a mut String,
    total_matches: &'a mut usize,
    head_limit: usize,
    needs_separator: bool,
    had_output: bool,
}

impl Sink for ContentSink<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if *self.total_matches >= self.head_limit {
            return Ok(false);
        }
        *self.total_matches += 1;

        if self.needs_separator {
            self.output.push_str("--\n");
            self.needs_separator = false;
        }
        self.had_output = true;

        let line = String::from_utf8_lossy(mat.bytes());
        if let Some(n) = mat.line_number() {
            let _ = write!(self.output, "{}:{}:{}", self.path, n, line);
        } else {
            let _ = write!(self.output, "{}:{}", self.path, line);
        }
        if !line.ends_with('\n') {
            self.output.push('\n');
        }
        Ok(true)
    }

    fn context(&mut self, _: &Searcher, ctx: &SinkContext<'_>) -> Result<bool, Self::Error> {
        if *self.total_matches >= self.head_limit {
            return Ok(false);
        }
        if self.needs_separator {
            self.output.push_str("--\n");
            self.needs_separator = false;
        }

        let line = String::from_utf8_lossy(ctx.bytes());
        if let Some(n) = ctx.line_number() {
            let _ = write!(self.output, "{}-{}-{}", self.path, n, line);
        } else {
            let _ = write!(self.output, "{}-{}", self.path, line);
        }
        if !line.ends_with('\n') {
            self.output.push('\n');
        }
        Ok(true)
    }

    fn context_break(&mut self, _: &Searcher) -> Result<bool, Self::Error> {
        if self.had_output {
            self.needs_separator = true;
        }
        Ok(true)
    }
}

/// Short-circuits on first match — used by `files_with_matches` mode.
struct FileMatchSink<'a> {
    found: &'a mut bool,
}

impl Sink for FileMatchSink<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _: &Searcher, _: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        *self.found = true;
        Ok(false)
    }
}

/// Counts matches in a single file — used by `count` mode.
struct CountSink<'a> {
    count: &'a mut u64,
}

impl Sink for CountSink<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _: &Searcher, _: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        *self.count += 1;
        Ok(true)
    }
}
