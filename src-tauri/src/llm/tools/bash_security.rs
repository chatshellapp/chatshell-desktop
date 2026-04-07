//! Bash command security analysis.
//!
//! Implements a multi-layered security validator pipeline. Each validator is an
//! independent function that inspects the command and returns a SecurityVerdict.
//! The pipeline runs all validators and returns the most severe verdict.
//!
//! Architecture:
//! - AST-based analysis via tree-sitter for structural understanding
//! - Quote-aware content extraction producing multiple views of the command
//! - Independent validator functions for each security concern
//! - Compound command splitting for per-subcommand analysis

use std::collections::HashSet;
use std::sync::LazyLock;

use super::bash_ast;

/// Result of a security check on a command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecurityVerdict {
    /// Command appears safe to execute.
    Allow,
    /// Command is blocked with the given reason.
    Block(String),
    /// Command requires a warning to be prepended to the output.
    Warn(String),
}

// ---------------------------------------------------------------------------
// Quote-aware content extraction
// ---------------------------------------------------------------------------

/// Extracted views of a command with different quoting levels stripped.
///
/// Produces multiple views so that validators can check patterns against the
/// appropriate quote context.
struct QuoteExtracted {
    /// Content with single-quoted sections removed but double-quoted sections preserved.
    /// Used for patterns that bash expands inside double quotes (e.g., `$()`, backticks).
    with_double_quotes: String,
    /// Content with both single and double quoted sections removed.
    /// Used for patterns that only apply in unquoted context (e.g., redirections, pipes).
    fully_unquoted: String,
}

fn extract_quoted_content(command: &str) -> QuoteExtracted {
    let mut with_double_quotes = String::new();
    let mut fully_unquoted = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    let bytes = command.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let ch = bytes[i];

        // Backslash escape outside single quotes
        if ch == b'\\' && !in_single_quote && i + 1 < bytes.len() {
            let next = bytes[i + 1] as char;
            if !in_single_quote {
                with_double_quotes.push('\\');
                with_double_quotes.push(next);
            }
            if !in_single_quote && !in_double_quote {
                fully_unquoted.push('\\');
                fully_unquoted.push(next);
            }
            i += 2;
            continue;
        }

        if ch == b'\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            i += 1;
            continue;
        }

        if ch == b'"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            i += 1;
            continue;
        }

        let c = ch as char;
        if !in_single_quote {
            with_double_quotes.push(c);
        }
        if !in_single_quote && !in_double_quote {
            fully_unquoted.push(c);
        }
        i += 1;
    }

    QuoteExtracted {
        with_double_quotes,
        fully_unquoted,
    }
}

// ---------------------------------------------------------------------------
// Safe wrapper stripping
// ---------------------------------------------------------------------------

/// Environment variable names safe to strip from commands for pattern matching.
/// These cannot execute code, load libraries, or alter program search paths.
///
/// SECURITY: Never add PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_*, PYTHONPATH,
/// NODE_PATH, CLASSPATH, RUBYLIB, GOFLAGS, RUSTFLAGS, NODE_OPTIONS, HOME,
/// TMPDIR, SHELL, or BASH_ENV — these can execute code or affect behavior.
static SAFE_ENV_VARS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    [
        // Go build settings
        "GOEXPERIMENT",
        "GOOS",
        "GOARCH",
        "CGO_ENABLED",
        "GO111MODULE",
        // Rust logging/debugging
        "RUST_BACKTRACE",
        "RUST_LOG",
        // Node environment name (NOT NODE_OPTIONS!)
        "NODE_ENV",
        // Python behavior flags (NOT PYTHONPATH!)
        "PYTHONUNBUFFERED",
        "PYTHONDONTWRITEBYTECODE",
        // Pytest configuration
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD",
        "PYTEST_DEBUG",
        // Locale and encoding
        "LANG",
        "LANGUAGE",
        "LC_ALL",
        "LC_CTYPE",
        "LC_TIME",
        "CHARSET",
        // Terminal and display
        "TERM",
        "COLORTERM",
        "NO_COLOR",
        "FORCE_COLOR",
        "TZ",
        // Color configuration
        "LS_COLORS",
        "LSCOLORS",
        "GREP_COLOR",
        "GREP_COLORS",
        "GCC_COLORS",
        // Display formatting
        "TIME_STYLE",
        "BLOCK_SIZE",
        "BLOCKSIZE",
        // CI indicator
        "CI",
    ]
    .into_iter()
    .collect()
});

/// Advance past horizontal whitespace (space and tab only, NOT newlines).
/// Newlines are command separators in bash; matching across them would be unsafe.
fn skip_hws(s: &str) -> &str {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() && matches!(bytes[i], b' ' | b'\t') {
        i += 1;
    }
    &s[i..]
}

/// Require at least one horizontal whitespace character, then skip all of them.
fn require_hws(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    if bytes.is_empty() || !matches!(bytes[0], b' ' | b'\t') {
        return None;
    }
    Some(skip_hws(s))
}

/// Safe characters for timeout/nice flag values: [A-Za-z0-9_.+-]
/// Rejects $, `, (, ), |, ;, & to prevent injection via flag values.
fn is_safe_flag_value_byte(b: u8) -> bool {
    matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'+' | b'-')
}

/// Safe characters for env var values: [A-Za-z0-9_./:-]
fn is_safe_env_value_byte(b: u8) -> bool {
    matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'/' | b':' | b'-')
}

/// Try to strip one `VAR=value ` env assignment from the start.
/// Only strips if VAR is in SAFE_ENV_VARS and value uses only safe characters.
fn try_strip_env_assignment(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    if bytes.is_empty() || !matches!(bytes[0], b'A'..=b'Z' | b'a'..=b'z' | b'_') {
        return None;
    }

    let mut i = 1;
    while i < bytes.len() && matches!(bytes[i], b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_') {
        i += 1;
    }

    if i >= bytes.len() || bytes[i] != b'=' {
        return None;
    }
    let var_name = &s[..i];
    i += 1;

    if !SAFE_ENV_VARS.contains(var_name) {
        return None;
    }

    let val_start = i;
    while i < bytes.len() && is_safe_env_value_byte(bytes[i]) {
        i += 1;
    }
    if i == val_start {
        return None;
    }

    require_hws(&s[i..])
}

/// Try to strip `timeout [flags] DURATION ` from the start.
///
/// Handles GNU timeout flags: --foreground, --preserve-status, --verbose (no-arg),
/// --kill-after, --signal (with value via = or space), -v (no-arg), -k/-s (with value).
fn try_strip_timeout(s: &str) -> Option<&str> {
    let rest = s.strip_prefix("timeout")?;
    let mut rest = require_hws(rest)?;

    loop {
        let bytes = rest.as_bytes();
        if bytes.is_empty() || bytes[0] != b'-' {
            break;
        }

        // `--` end-of-options marker
        if rest.starts_with("-- ") || rest.starts_with("--\t") {
            rest = skip_hws(&rest[2..]);
            break;
        }

        // No-value long flags
        if let Some(after) = rest
            .strip_prefix("--foreground")
            .or_else(|| rest.strip_prefix("--preserve-status"))
            .or_else(|| rest.strip_prefix("--verbose"))
        {
            rest = require_hws(after)?;
            continue;
        }

        // Value-taking long flags (=fused form)
        if let Some(after) = rest
            .strip_prefix("--kill-after=")
            .or_else(|| rest.strip_prefix("--signal="))
        {
            let bytes = after.as_bytes();
            let mut j = 0;
            while j < bytes.len() && is_safe_flag_value_byte(bytes[j]) {
                j += 1;
            }
            if j == 0 {
                return None;
            }
            rest = require_hws(&after[j..])?;
            continue;
        }

        // Value-taking long flags (space-separated form)
        if let Some(after) = rest
            .strip_prefix("--kill-after")
            .or_else(|| rest.strip_prefix("--signal"))
        {
            let val_s = require_hws(after)?;
            let bytes = val_s.as_bytes();
            let mut j = 0;
            while j < bytes.len() && is_safe_flag_value_byte(bytes[j]) {
                j += 1;
            }
            if j == 0 {
                return None;
            }
            rest = require_hws(&val_s[j..])?;
            continue;
        }

        // Short flag: -v (no value)
        if rest.starts_with("-v") && rest.len() > 2 && matches!(rest.as_bytes()[2], b' ' | b'\t') {
            rest = require_hws(&rest[2..])?;
            continue;
        }

        // Short flags: -k, -s (with value, fused or space-separated)
        if rest.len() >= 2
            && rest.as_bytes()[0] == b'-'
            && matches!(rest.as_bytes()[1], b'k' | b's')
        {
            let after_flag = &rest[2..];
            if !after_flag.is_empty() && !matches!(after_flag.as_bytes()[0], b' ' | b'\t') {
                let bytes = after_flag.as_bytes();
                let mut j = 0;
                while j < bytes.len() && is_safe_flag_value_byte(bytes[j]) {
                    j += 1;
                }
                if j == 0 {
                    return None;
                }
                rest = require_hws(&after_flag[j..])?;
            } else {
                let val_s = require_hws(after_flag)?;
                let bytes = val_s.as_bytes();
                let mut j = 0;
                while j < bytes.len() && is_safe_flag_value_byte(bytes[j]) {
                    j += 1;
                }
                if j == 0 {
                    return None;
                }
                rest = require_hws(&val_s[j..])?;
            }
            continue;
        }

        // Unknown flag — fail closed
        return None;
    }

    // Duration: \d+(\.\d+)?[smhd]?
    let bytes = rest.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
    }
    if i < bytes.len() && matches!(bytes[i], b's' | b'm' | b'h' | b'd') {
        i += 1;
    }

    require_hws(&rest[i..])
}

/// Try to strip `time [--] ` from the start.
fn try_strip_time(s: &str) -> Option<&str> {
    let rest = s.strip_prefix("time")?;
    let rest = require_hws(rest)?;
    if let Some(after) = rest.strip_prefix("--") {
        if let Some(r) = require_hws(after) {
            return Some(r);
        }
    }
    Some(rest)
}

/// Try to strip `nice [-n N | -N] [--] ` from the start.
fn try_strip_nice(s: &str) -> Option<&str> {
    let rest = s.strip_prefix("nice")?;
    let rest = require_hws(rest)?;

    let rest =
        if rest.starts_with("-n") && rest.len() > 2 && matches!(rest.as_bytes()[2], b' ' | b'\t') {
            // `-n N` form
            let after_n = require_hws(&rest[2..])?;
            let bytes = after_n.as_bytes();
            let mut i = 0;
            if i < bytes.len() && bytes[i] == b'-' {
                i += 1;
            }
            let digit_start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i == digit_start {
                return None;
            }
            require_hws(&after_n[i..])?
        } else if rest.starts_with('-') && rest.len() > 1 && rest.as_bytes()[1].is_ascii_digit() {
            // Legacy `-N` form
            let bytes = rest.as_bytes();
            let mut i = 1;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            require_hws(&rest[i..])?
        } else {
            // Bare `nice cmd`
            rest
        };

    if let Some(after) = rest.strip_prefix("--") {
        if let Some(r) = require_hws(after) {
            return Some(r);
        }
    }
    Some(rest)
}

/// Try to strip `nohup [--] ` from the start.
fn try_strip_nohup(s: &str) -> Option<&str> {
    let rest = s.strip_prefix("nohup")?;
    let rest = require_hws(rest)?;
    if let Some(after) = rest.strip_prefix("--") {
        if let Some(r) = require_hws(after) {
            return Some(r);
        }
    }
    Some(rest)
}

/// Try to strip `stdbuf (-[ioe][LN0-9]+)+ [--] ` from the start.
fn try_strip_stdbuf(s: &str) -> Option<&str> {
    let rest = s.strip_prefix("stdbuf")?;
    let mut rest = require_hws(rest)?;

    let mut found_flag = false;
    loop {
        let bytes = rest.as_bytes();
        if bytes.len() < 3 || bytes[0] != b'-' || !matches!(bytes[1], b'i' | b'o' | b'e') {
            break;
        }
        let mut i = 2;
        while i < bytes.len() && matches!(bytes[i], b'L' | b'N' | b'0'..=b'9') {
            i += 1;
        }
        if i == 2 {
            break;
        }
        found_flag = true;
        rest = require_hws(&rest[i..])?;
    }

    if !found_flag {
        return None;
    }

    if let Some(after) = rest.strip_prefix("--") {
        if let Some(r) = require_hws(after) {
            return Some(r);
        }
    }
    Some(rest)
}

/// Strip safe wrapper commands and env var assignments to reveal the actual
/// command being executed.
///
/// Normalizes for pattern matching:
/// - `timeout 5 npm run build` -> `npm run build`
/// - `GOOS=linux go build` -> `go build`
/// - `nohup nice -n 10 cmd` -> `cmd`
/// - `time cmd` -> `cmd`
/// - `stdbuf -o0 cmd` -> `cmd`
///
/// Two-phase approach (matching real shell semantics):
/// - Phase 1: Strip env vars (bash treats `VAR=val cmd` as assignment)
/// - Phase 2: Strip wrappers (wrappers use execvp, so VAR=val after a wrapper
///   is a command to execute, NOT an env assignment)
pub fn strip_safe_wrappers(command: &str) -> &str {
    let mut s = command;

    // Phase 1: Strip leading safe env var assignments
    loop {
        let prev_len = s.len();
        s = skip_hws(s);
        if let Some(rest) = try_strip_env_assignment(s) {
            s = rest;
        }
        if s.len() == prev_len {
            break;
        }
    }

    // Phase 2: Strip wrapper commands (timeout, time, nice, nohup, stdbuf)
    loop {
        let prev_len = s.len();
        s = skip_hws(s);
        if let Some(rest) = try_strip_timeout(s) {
            s = rest;
        } else if let Some(rest) = try_strip_time(s) {
            s = rest;
        } else if let Some(rest) = try_strip_nice(s) {
            s = rest;
        } else if let Some(rest) = try_strip_nohup(s) {
            s = rest;
        } else if let Some(rest) = try_strip_stdbuf(s) {
            s = rest;
        }
        if s.len() == prev_len {
            break;
        }
    }

    s.trim()
}

// ---------------------------------------------------------------------------
// Validation context
// ---------------------------------------------------------------------------

/// Shared context passed to each validator, containing pre-computed views.
struct ValidationContext<'a> {
    /// The original command string.
    original: &'a str,
    /// Command after stripping safe wrappers and env vars.
    stripped: &'a str,
    /// Content with single-quoted sections removed (double-quoted preserved).
    unquoted_content: String,
    /// Content with both single and double quoted sections removed.
    fully_unquoted: String,
    /// Tree-sitter AST analysis (None if parser unavailable or command too long).
    ast: Option<bash_ast::AstAnalysis>,
}

impl<'a> ValidationContext<'a> {
    fn new(command: &'a str) -> Self {
        let extracted = extract_quoted_content(command);
        let ast = bash_ast::analyze(command);
        let stripped = strip_safe_wrappers(command);
        Self {
            original: command,
            stripped,
            unquoted_content: extracted.with_double_quotes,
            fully_unquoted: extracted.fully_unquoted,
            ast,
        }
    }
}

// ---------------------------------------------------------------------------
// Compound command splitting
// ---------------------------------------------------------------------------

/// Split a command string on shell operators (`&&`, `||`, `;`, `|`)
/// while respecting single quotes, double quotes, backticks, `$(...)`,
/// `${...}`, and backslash escapes.
///
/// Each returned element is a trimmed subcommand string.
pub fn split_compound_command(command: &str) -> Vec<&str> {
    let bytes = command.as_bytes();
    let len = bytes.len();
    let mut parts: Vec<&str> = Vec::new();
    let mut start = 0;
    let mut i = 0;

    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_backtick = false;
    let mut paren_depth: u32 = 0;
    let mut brace_depth: u32 = 0;

    while i < len {
        let ch = bytes[i];

        if ch == b'\\' && !in_single_quote && i + 1 < len {
            i += 2;
            continue;
        }

        if ch == b'\'' && !in_double_quote && !in_backtick {
            in_single_quote = !in_single_quote;
            i += 1;
            continue;
        }

        if in_single_quote {
            i += 1;
            continue;
        }

        if ch == b'"' && !in_backtick {
            in_double_quote = !in_double_quote;
            i += 1;
            continue;
        }

        if ch == b'`' {
            in_backtick = !in_backtick;
            i += 1;
            continue;
        }

        if ch == b'$' && i + 1 < len {
            let next = bytes[i + 1];
            if next == b'(' {
                paren_depth += 1;
                i += 2;
                continue;
            }
            if next == b'{' {
                brace_depth += 1;
                i += 2;
                continue;
            }
        }

        if ch == b')' && paren_depth > 0 {
            paren_depth -= 1;
            i += 1;
            continue;
        }
        if ch == b'}' && brace_depth > 0 {
            brace_depth -= 1;
            i += 1;
            continue;
        }

        if in_double_quote || in_backtick || paren_depth > 0 || brace_depth > 0 {
            i += 1;
            continue;
        }

        // Operator detection
        if ch == b'&' && i + 1 < len && bytes[i + 1] == b'&' {
            push_trimmed(&mut parts, &command[start..i]);
            i += 2;
            start = i;
            continue;
        }
        if ch == b'|' && i + 1 < len && bytes[i + 1] == b'|' {
            push_trimmed(&mut parts, &command[start..i]);
            i += 2;
            start = i;
            continue;
        }
        if ch == b'|' {
            push_trimmed(&mut parts, &command[start..i]);
            i += 1;
            start = i;
            continue;
        }
        if ch == b';' {
            push_trimmed(&mut parts, &command[start..i]);
            i += 1;
            start = i;
            continue;
        }

        i += 1;
    }

    push_trimmed(&mut parts, &command[start..]);
    parts
}

fn push_trimmed<'a>(parts: &mut Vec<&'a str>, s: &'a str) {
    let t = s.trim();
    if !t.is_empty() {
        parts.push(t);
    }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/// Block control characters that bash silently drops but that can hide
/// metacharacters from our validators.
fn validate_control_characters(ctx: &ValidationContext) -> SecurityVerdict {
    for &b in ctx.original.as_bytes() {
        if matches!(b, 0x00..=0x08 | 0x0B..=0x0C | 0x0E..=0x1F | 0x7F) {
            return SecurityVerdict::Block(
                "Command contains non-printable control characters that could bypass security checks"
                    .into(),
            );
        }
    }
    SecurityVerdict::Allow
}

/// Detect incomplete command fragments that look like continuations.
fn validate_incomplete_commands(ctx: &ValidationContext) -> SecurityVerdict {
    let trimmed = ctx.original.trim();
    if trimmed.starts_with('\t') {
        return SecurityVerdict::Warn(
            "Command appears to be an incomplete fragment (starts with tab)".into(),
        );
    }
    if trimmed.starts_with('-') {
        return SecurityVerdict::Warn(
            "Command appears to be an incomplete fragment (starts with flags)".into(),
        );
    }
    if trimmed.starts_with("&&")
        || trimmed.starts_with("||")
        || trimmed.starts_with(';')
        || trimmed.starts_with('>')
        || trimmed.starts_with('<')
    {
        return SecurityVerdict::Warn(
            "Command appears to be a continuation line (starts with operator)".into(),
        );
    }
    SecurityVerdict::Allow
}

/// Detect command substitution and process substitution patterns.
///
/// Checks `unquoted_content` (single-quoted sections stripped, double-quoted
/// preserved) because `$()`, backticks, `${}` expand inside double quotes.
fn validate_dangerous_patterns(ctx: &ValidationContext) -> SecurityVerdict {
    let content = &ctx.unquoted_content;

    // Check for unescaped backticks
    if has_unescaped_char(content, b'`') {
        return SecurityVerdict::Warn(
            "[security notice] Command contains backticks (`) for command substitution".into(),
        );
    }

    struct Pattern {
        needle: &'static str,
        message: &'static str,
    }

    const PATTERNS: &[Pattern] = &[
        Pattern {
            needle: "<(",
            message: "process substitution <()",
        },
        Pattern {
            needle: ">(",
            message: "process substitution >()",
        },
        Pattern {
            needle: "=(",
            message: "Zsh process substitution =()",
        },
        Pattern {
            needle: "$(",
            message: "$() command substitution",
        },
        Pattern {
            needle: "${",
            message: "${} parameter substitution",
        },
        Pattern {
            needle: "$[",
            message: "$[] legacy arithmetic expansion",
        },
    ];

    for p in PATTERNS {
        if content.contains(p.needle) {
            return SecurityVerdict::Warn(format!(
                "[security notice] Command contains {}",
                p.message
            ));
        }
    }

    SecurityVerdict::Allow
}

/// Detect variables in dangerous positions (adjacent to pipes or redirections).
fn validate_dangerous_variables(ctx: &ValidationContext) -> SecurityVerdict {
    let content = &ctx.fully_unquoted;

    let has_var_near_redirect = {
        let bytes = content.as_bytes();
        let len = bytes.len();
        let mut found = false;
        for i in 0..len {
            if matches!(bytes[i], b'<' | b'>' | b'|') {
                // Look ahead for $VAR
                let rest = &content[i..];
                if rest.len() > 2 {
                    let after_ws = rest
                        .trim_start_matches(|c: char| c.is_ascii_whitespace() || "<>|".contains(c));
                    if after_ws.starts_with('$')
                        && after_ws
                            .as_bytes()
                            .get(1)
                            .map_or(false, |b| b.is_ascii_alphabetic() || *b == b'_')
                    {
                        found = true;
                        break;
                    }
                }
                // Look behind for $VAR
                if i > 0 {
                    let before = &content[..i];
                    let before_ws = before.trim_end();
                    if !before_ws.is_empty() {
                        let last_word = before_ws
                            .rsplit_once(char::is_whitespace)
                            .map_or(before_ws, |t| t.1);
                        if last_word.starts_with('$')
                            && last_word
                                .as_bytes()
                                .get(1)
                                .map_or(false, |b| b.is_ascii_alphabetic() || *b == b'_')
                        {
                            found = true;
                            break;
                        }
                    }
                }
            }
        }
        found
    };

    if has_var_near_redirect {
        return SecurityVerdict::Warn(
            "[security notice] Command contains variables in dangerous contexts (redirections or pipes)"
                .into(),
        );
    }
    SecurityVerdict::Allow
}

/// Detect redirections in unquoted context.
fn validate_redirections(ctx: &ValidationContext) -> SecurityVerdict {
    let content = &ctx.fully_unquoted;

    if content.contains('<') {
        return SecurityVerdict::Warn(
            "[security notice] Command contains input redirection (<) which could read sensitive files"
                .into(),
        );
    }
    if content.contains('>') {
        return SecurityVerdict::Warn(
            "[security notice] Command contains output redirection (>) which could write to arbitrary files"
                .into(),
        );
    }
    SecurityVerdict::Allow
}

/// Detect IFS variable usage that could bypass validation.
fn validate_ifs_injection(ctx: &ValidationContext) -> SecurityVerdict {
    if ctx.original.contains("$IFS") || ctx.original.contains("${IFS") {
        return SecurityVerdict::Warn(
            "[security notice] Command contains IFS variable usage which could bypass security validation"
                .into(),
        );
    }
    SecurityVerdict::Allow
}

/// Detect /proc/*/environ access.
fn validate_proc_environ(ctx: &ValidationContext) -> SecurityVerdict {
    if contains_pattern(ctx.original, "/proc/", "/environ") {
        return SecurityVerdict::Warn(
            "[security notice] Command accesses /proc/*/environ which could expose sensitive environment variables"
                .into(),
        );
    }
    SecurityVerdict::Allow
}

/// Detect unquoted newlines that could separate multiple commands.
fn validate_newlines(ctx: &ValidationContext) -> SecurityVerdict {
    let content = &ctx.fully_unquoted;

    if !content.contains('\n') && !content.contains('\r') {
        return SecurityVerdict::Allow;
    }

    let bytes = content.as_bytes();
    for i in 0..bytes.len() {
        if matches!(bytes[i], b'\n' | b'\r') {
            // Check if followed by non-whitespace (looks like a command)
            if let Some(rest) = content.get(i + 1..) {
                let after_ws = rest.trim_start();
                if !after_ws.is_empty() {
                    // Allow backslash-newline continuation at word boundary
                    if i > 0 && bytes[i - 1] == b'\\' {
                        let before_bs = if i >= 2 { bytes[i - 2] } else { b' ' };
                        if before_bs.is_ascii_whitespace() {
                            continue;
                        }
                    }
                    return SecurityVerdict::Warn(
                        "[security notice] Command contains newlines that could separate multiple commands"
                            .into(),
                    );
                }
            }
        }
    }
    SecurityVerdict::Allow
}

/// Detect backslash-escaped whitespace outside quotes.
fn validate_backslash_escaped_whitespace(ctx: &ValidationContext) -> SecurityVerdict {
    let bytes = ctx.original.as_bytes();
    let len = bytes.len();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut i = 0;

    while i < len {
        let ch = bytes[i];

        if ch == b'\\' && !in_single_quote {
            if !in_double_quote && i + 1 < len {
                let next = bytes[i + 1];
                if next == b' ' || next == b'\t' {
                    return SecurityVerdict::Warn(
                        "[security notice] Command contains backslash-escaped whitespace that could alter command parsing"
                            .into(),
                    );
                }
            }
            i += 2;
            continue;
        }

        if ch == b'"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        } else if ch == b'\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
        }
        i += 1;
    }
    SecurityVerdict::Allow
}

/// Detect backslash-escaped shell operators outside quotes.
fn validate_backslash_escaped_operators(ctx: &ValidationContext) -> SecurityVerdict {
    let bytes = ctx.original.as_bytes();
    let len = bytes.len();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut i = 0;

    while i < len {
        let ch = bytes[i];

        // Handle backslash first (before quote toggles)
        if ch == b'\\' && !in_single_quote {
            if !in_double_quote && i + 1 < len {
                let next = bytes[i + 1];
                if matches!(next, b';' | b'|' | b'&' | b'<' | b'>') {
                    return SecurityVerdict::Warn(
                        "[security notice] Command contains a backslash before a shell operator which can hide command structure"
                            .into(),
                    );
                }
            }
            i += 2;
            continue;
        }

        if ch == b'\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
        } else if ch == b'"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        }
        i += 1;
    }
    SecurityVerdict::Allow
}

/// Detect brace expansion syntax in unquoted context.
fn validate_brace_expansion(ctx: &ValidationContext) -> SecurityVerdict {
    let content = &ctx.fully_unquoted;
    let bytes = content.as_bytes();

    for i in 0..bytes.len() {
        if bytes[i] != b'{' || is_escaped_at(bytes, i) {
            continue;
        }

        // Find matching unescaped `}` tracking nesting depth
        let mut depth: u32 = 1;
        let mut j = i + 1;
        let mut matching_close = None;
        while j < bytes.len() && depth > 0 {
            if bytes[j] == b'{' && !is_escaped_at(bytes, j) {
                depth += 1;
            } else if bytes[j] == b'}' && !is_escaped_at(bytes, j) {
                depth -= 1;
                if depth == 0 {
                    matching_close = Some(j);
                }
            }
            j += 1;
        }

        let Some(close) = matching_close else {
            continue;
        };

        // Check for `,` or `..` at outer nesting level between { and }
        let mut inner_depth: u32 = 0;
        for k in (i + 1)..close {
            if bytes[k] == b'{' && !is_escaped_at(bytes, k) {
                inner_depth += 1;
            } else if bytes[k] == b'}' && !is_escaped_at(bytes, k) {
                inner_depth = inner_depth.saturating_sub(1);
            } else if inner_depth == 0 {
                if bytes[k] == b',' || (bytes[k] == b'.' && k + 1 < close && bytes[k + 1] == b'.') {
                    return SecurityVerdict::Warn(
                        "[security notice] Command contains brace expansion that could alter command parsing"
                            .into(),
                    );
                }
            }
        }
    }
    SecurityVerdict::Allow
}

/// Detect Unicode whitespace characters that could cause parsing inconsistencies.
fn validate_unicode_whitespace(ctx: &ValidationContext) -> SecurityVerdict {
    for ch in ctx.original.chars() {
        if matches!(
            ch,
            '\u{00A0}' | '\u{1680}' | '\u{2000}'
                ..='\u{200A}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202F}'
                    | '\u{205F}'
                    | '\u{3000}'
                    | '\u{FEFF}'
        ) {
            return SecurityVerdict::Warn(
                "[security notice] Command contains Unicode whitespace characters that could cause parsing inconsistencies"
                    .into(),
            );
        }
    }
    SecurityVerdict::Allow
}

/// Detect ANSI-C quoting ($'...') and locale quoting ($"...") which can
/// encode arbitrary characters via escape sequences.
fn validate_ansi_c_quoting(ctx: &ValidationContext) -> SecurityVerdict {
    let cmd = ctx.original;
    let bytes = cmd.as_bytes();

    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i] == b'$' && (bytes[i + 1] == b'\'' || bytes[i + 1] == b'"') {
            let quote = bytes[i + 1];
            // Look for closing quote
            if bytes[i + 2..].iter().any(|&b| b == quote) {
                let msg = if quote == b'\'' {
                    "[security notice] Command contains ANSI-C quoting ($'...') which can hide characters"
                } else {
                    "[security notice] Command contains locale quoting ($\"...\") which can hide characters"
                };
                return SecurityVerdict::Warn(msg.into());
            }
        }
    }
    SecurityVerdict::Allow
}

/// Detect Zsh-specific dangerous commands that can bypass security checks.
fn validate_zsh_dangerous_commands(ctx: &ValidationContext) -> SecurityVerdict {
    const ZSH_DANGEROUS: &[&str] = &[
        "zmodload", "emulate", "sysopen", "sysread", "syswrite", "sysseek", "zpty", "ztcp",
        "zsocket", "zf_rm", "zf_mv", "zf_ln", "zf_chmod", "zf_chown", "zf_mkdir", "zf_rmdir",
        "zf_chgrp",
    ];

    // Use the stripped command (env vars and safe wrappers already removed)
    // to find the real base command
    let base = ctx
        .stripped
        .split_whitespace()
        .find(|w| !matches!(*w, "command" | "builtin" | "noglob" | "nocorrect"))
        .unwrap_or("");

    if ZSH_DANGEROUS.contains(&base) {
        return SecurityVerdict::Warn(format!(
            "[security notice] Command uses Zsh-specific '{}' which can bypass security checks",
            base
        ));
    }

    // fc -e is an eval-equivalent
    if base == "fc" && ctx.stripped.contains("-e") {
        return SecurityVerdict::Warn(
            "[security notice] Command uses 'fc -e' which can execute arbitrary commands via editor"
                .into(),
        );
    }

    SecurityVerdict::Allow
}

/// Detect eval keyword at word boundary (outside single quotes).
/// Checked with quote awareness so `'eval ...'` is not flagged.
fn validate_eval(ctx: &ValidationContext) -> SecurityVerdict {
    let bytes = ctx.original.as_bytes();
    let len = bytes.len();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut i = 0;

    while i < len {
        let ch = bytes[i];

        if ch == b'\\' && !in_single_quote && i + 1 < len {
            i += 2;
            continue;
        }
        if ch == b'\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            i += 1;
            continue;
        }
        if in_single_quote {
            i += 1;
            continue;
        }
        if ch == b'"' {
            in_double_quote = !in_double_quote;
            i += 1;
            continue;
        }

        if !in_double_quote && ch == b'e' && is_eval_at(bytes, i) {
            return SecurityVerdict::Warn(
                "[security notice] eval keyword detected — commands may be constructed dynamically"
                    .into(),
            );
        }

        i += 1;
    }
    SecurityVerdict::Allow
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// True when `bytes[pos..]` starts with `eval` at a word boundary.
fn is_eval_at(bytes: &[u8], pos: usize) -> bool {
    if pos + 4 > bytes.len() {
        return false;
    }
    if &bytes[pos..pos + 4] != b"eval" {
        return false;
    }
    if pos > 0 && (bytes[pos - 1] as char).is_alphanumeric() {
        return false;
    }
    if pos + 4 < bytes.len() {
        let next = bytes[pos + 4];
        if (next as char).is_alphanumeric() || next == b'_' {
            return false;
        }
    }
    true
}

/// True when an unescaped occurrence of `char_byte` exists in `content`.
fn has_unescaped_char(content: &str, char_byte: u8) -> bool {
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if bytes[i] == char_byte {
            return true;
        }
        i += 1;
    }
    false
}

/// True when the character at `pos` is escaped by an odd number of preceding backslashes.
fn is_escaped_at(bytes: &[u8], pos: usize) -> bool {
    let mut count = 0u32;
    let mut i = pos;
    while i > 0 {
        i -= 1;
        if bytes[i] == b'\\' {
            count += 1;
        } else {
            break;
        }
    }
    count % 2 == 1
}

/// Check if `haystack` contains the pattern `prefix...suffix` (with anything between).
fn contains_pattern(haystack: &str, prefix: &str, suffix: &str) -> bool {
    if let Some(start) = haystack.find(prefix) {
        let rest = &haystack[start + prefix.len()..];
        return rest.contains(suffix);
    }
    false
}

fn truncate_for_log(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

// ---------------------------------------------------------------------------
// AST-based validators (tree-sitter)
// ---------------------------------------------------------------------------

/// Use the tree-sitter AST to detect parse errors (malformed syntax).
/// Malformed commands could exploit parser differentials.
fn validate_ast_parse_errors(ctx: &ValidationContext) -> SecurityVerdict {
    if let Some(ref ast) = ctx.ast {
        if ast.has_parse_errors {
            return SecurityVerdict::Warn(
                "[security notice] Command contains malformed syntax that could be misinterpreted"
                    .into(),
            );
        }
    }
    SecurityVerdict::Allow
}

/// Use the AST to detect command substitution, process substitution, and
/// parameter expansion with structural accuracy (no regex false positives).
fn validate_ast_dangerous_patterns(ctx: &ValidationContext) -> SecurityVerdict {
    let Some(ref ast) = ctx.ast else {
        return SecurityVerdict::Allow;
    };

    let mut warnings: Vec<&str> = Vec::new();

    if ast.dangerous.has_command_substitution {
        warnings.push("command substitution ($() or backticks)");
    }
    if ast.dangerous.has_process_substitution {
        warnings.push("process substitution (<() or >())");
    }
    if ast.dangerous.has_parameter_expansion {
        warnings.push("parameter expansion (${...})");
    }

    if warnings.is_empty() {
        SecurityVerdict::Allow
    } else {
        SecurityVerdict::Warn(format!(
            "[security notice] AST analysis detected: {}",
            warnings.join(", ")
        ))
    }
}

/// Use the AST to detect subshells and command groups, which can hide
/// dangerous operations inside structural constructs.
fn validate_ast_compound_structure(ctx: &ValidationContext) -> SecurityVerdict {
    let Some(ref ast) = ctx.ast else {
        return SecurityVerdict::Allow;
    };

    if ast.compound.has_subshell {
        return SecurityVerdict::Warn(
            "[security notice] Command contains subshell (...) which executes in a child process"
                .into(),
        );
    }
    if ast.compound.has_command_group {
        return SecurityVerdict::Warn(
            "[security notice] Command contains command group {...} which groups operations".into(),
        );
    }
    SecurityVerdict::Allow
}

/// When the AST confirms NO actual operator nodes exist, suppress the
/// backslash-escaped-operator warning (eliminates `find -exec \;` false positive).
fn validate_backslash_escaped_operators_with_ast(ctx: &ValidationContext) -> SecurityVerdict {
    if let Some(ref ast) = ctx.ast {
        if !ast.has_actual_operators {
            return SecurityVerdict::Allow;
        }
    }
    validate_backslash_escaped_operators(ctx)
}

// ---------------------------------------------------------------------------
// Comprehensive security check — the pipeline
// ---------------------------------------------------------------------------

/// Run all security checks on a command.
///
/// Pipeline:
/// 1. Early blockers (control chars)
/// 2. Dangerous pattern check via caller-provided function (full + per-subcommand)
/// 3. Validator pipeline collecting the most severe verdict
pub fn check_command(
    command: &str,
    check_dangerous: fn(&str) -> Option<&'static str>,
) -> SecurityVerdict {
    // 1. Check the full command for dangerous patterns.
    if let Some(msg) = check_dangerous(command) {
        return SecurityVerdict::Block(msg.to_string());
    }

    // 1b. Also check after stripping safe wrappers (e.g. `timeout 5 rm -rf /`).
    let stripped = strip_safe_wrappers(command);
    if stripped != command {
        if let Some(msg) = check_dangerous(stripped) {
            return SecurityVerdict::Block(format!(
                "{} (after normalizing wrappers: {})",
                msg,
                truncate_for_log(stripped, 80),
            ));
        }
    }

    // 2. Split into subcommands and check each one.
    let subs = split_compound_command(command);
    for sub in &subs {
        if let Some(msg) = check_dangerous(sub) {
            return SecurityVerdict::Block(format!(
                "{} (in subcommand: {})",
                msg,
                truncate_for_log(sub, 80),
            ));
        }

        let stripped_sub = strip_safe_wrappers(sub);
        if stripped_sub != *sub {
            if let Some(msg) = check_dangerous(stripped_sub) {
                return SecurityVerdict::Block(format!(
                    "{} (in subcommand after normalizing wrappers: {})",
                    msg,
                    truncate_for_log(stripped_sub, 80),
                ));
            }
        }
    }

    // 3. Build validation context and run the validator pipeline.
    let ctx = ValidationContext::new(command);

    // Each validator returns Allow (continue), Warn (collect), or Block (stop).
    // AST-based validators run alongside regex validators for defense-in-depth.
    let validators: &[fn(&ValidationContext) -> SecurityVerdict] = &[
        validate_control_characters,
        validate_ast_parse_errors,
        validate_incomplete_commands,
        validate_ansi_c_quoting,
        validate_dangerous_patterns,
        validate_ast_dangerous_patterns,
        validate_ast_compound_structure,
        validate_dangerous_variables,
        validate_newlines,
        validate_ifs_injection,
        validate_proc_environ,
        validate_redirections,
        validate_backslash_escaped_whitespace,
        // Uses AST to skip false positive on `find -exec \;`
        validate_backslash_escaped_operators_with_ast,
        validate_unicode_whitespace,
        validate_brace_expansion,
        validate_zsh_dangerous_commands,
        validate_eval,
    ];

    let mut worst_warn: Option<String> = None;
    let mut all_warnings: Vec<String> = Vec::new();

    for validator in validators {
        match validator(&ctx) {
            SecurityVerdict::Block(msg) => return SecurityVerdict::Block(msg),
            SecurityVerdict::Warn(msg) => {
                if worst_warn.is_none() {
                    worst_warn = Some(msg.clone());
                }
                all_warnings.push(msg);
            }
            SecurityVerdict::Allow => {}
        }
    }

    if let Some(first) = worst_warn {
        if all_warnings.len() > 1 {
            return SecurityVerdict::Warn(format!(
                "{}; (+{} more warning(s))",
                first,
                all_warnings.len() - 1
            ));
        }
        return SecurityVerdict::Warn(first);
    }

    SecurityVerdict::Allow
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- split_compound_command -------------------------------------------

    #[test]
    fn split_simple() {
        assert_eq!(split_compound_command("echo hello"), vec!["echo hello"]);
    }

    #[test]
    fn split_and() {
        assert_eq!(
            split_compound_command("cd /tmp && ls -la"),
            vec!["cd /tmp", "ls -la"]
        );
    }

    #[test]
    fn split_or() {
        assert_eq!(
            split_compound_command("false || echo fallback"),
            vec!["false", "echo fallback"]
        );
    }

    #[test]
    fn split_pipe() {
        assert_eq!(
            split_compound_command("cat file | grep foo | wc -l"),
            vec!["cat file", "grep foo", "wc -l"]
        );
    }

    #[test]
    fn split_semicolon() {
        assert_eq!(
            split_compound_command("echo a; echo b; echo c"),
            vec!["echo a", "echo b", "echo c"]
        );
    }

    #[test]
    fn split_mixed() {
        assert_eq!(
            split_compound_command("cd /tmp && echo ok; ls | head"),
            vec!["cd /tmp", "echo ok", "ls", "head"]
        );
    }

    #[test]
    fn split_respects_single_quotes() {
        assert_eq!(
            split_compound_command("echo 'a && b' && echo done"),
            vec!["echo 'a && b'", "echo done"]
        );
    }

    #[test]
    fn split_respects_double_quotes() {
        assert_eq!(
            split_compound_command(r#"echo "a || b" || echo fail"#),
            vec![r#"echo "a || b""#, "echo fail"]
        );
    }

    #[test]
    fn split_respects_backtick_quoting() {
        assert_eq!(
            split_compound_command("echo `echo a && echo b` && echo done"),
            vec!["echo `echo a && echo b`", "echo done"]
        );
    }

    #[test]
    fn split_respects_dollar_paren() {
        assert_eq!(
            split_compound_command("echo $(echo a && echo b) && echo done"),
            vec!["echo $(echo a && echo b)", "echo done"]
        );
    }

    #[test]
    fn split_respects_backslash_escape() {
        assert_eq!(
            split_compound_command(r"echo a \&\& b && echo done"),
            vec![r"echo a \&\& b", "echo done"]
        );
    }

    #[test]
    fn split_nested_dollar_paren() {
        assert_eq!(
            split_compound_command("echo $(echo $(date)) && pwd"),
            vec!["echo $(echo $(date))", "pwd"]
        );
    }

    #[test]
    fn split_empty() {
        assert!(split_compound_command("").is_empty());
        assert!(split_compound_command("   ").is_empty());
    }

    // ---- extract_quoted_content -------------------------------------------

    #[test]
    fn extract_strips_single_quotes() {
        let e = extract_quoted_content("echo 'hello world' && ls");
        assert!(!e.with_double_quotes.contains("hello world"));
        assert!(!e.fully_unquoted.contains("hello world"));
    }

    #[test]
    fn extract_preserves_double_quoted_for_with_dq() {
        let e = extract_quoted_content(r#"echo "$(whoami)" foo"#);
        assert!(e.with_double_quotes.contains("$(whoami)"));
        assert!(!e.fully_unquoted.contains("$(whoami)"));
    }

    #[test]
    fn extract_backslash_escape() {
        let e = extract_quoted_content(r"echo \$(safe)");
        assert!(e.with_double_quotes.contains(r"\$"));
        assert!(e.fully_unquoted.contains(r"\$"));
    }

    // ---- individual validators -------------------------------------------

    #[test]
    fn control_chars_blocked() {
        let ctx = ValidationContext::new("echo safe\x00; rm -rf /");
        assert!(matches!(
            validate_control_characters(&ctx),
            SecurityVerdict::Block(_)
        ));
    }

    #[test]
    fn incomplete_starts_with_dash() {
        let ctx = ValidationContext::new("-la /tmp");
        assert!(matches!(
            validate_incomplete_commands(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn dangerous_patterns_dollar_paren() {
        let ctx = ValidationContext::new("echo $(whoami)");
        assert!(matches!(
            validate_dangerous_patterns(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn dangerous_patterns_backtick() {
        let ctx = ValidationContext::new("echo `id`");
        assert!(matches!(
            validate_dangerous_patterns(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn dangerous_patterns_safe_in_single_quotes() {
        let ctx = ValidationContext::new("echo '$(whoami)'");
        assert_eq!(validate_dangerous_patterns(&ctx), SecurityVerdict::Allow);
    }

    #[test]
    fn dangerous_patterns_dollar_paren_in_double_quotes() {
        let ctx = ValidationContext::new(r#"echo "$(whoami)""#);
        assert!(matches!(
            validate_dangerous_patterns(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn ifs_injection() {
        let ctx = ValidationContext::new("echo${IFS}hello");
        assert!(matches!(
            validate_ifs_injection(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn proc_environ() {
        let ctx = ValidationContext::new("cat /proc/self/environ");
        assert!(matches!(
            validate_proc_environ(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn newline_command_separation() {
        let ctx = ValidationContext::new("echo safe\nrm -rf /tmp");
        assert!(matches!(validate_newlines(&ctx), SecurityVerdict::Warn(_)));
    }

    #[test]
    fn backslash_escaped_whitespace() {
        let ctx = ValidationContext::new(r"echo\ test");
        assert!(matches!(
            validate_backslash_escaped_whitespace(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn backslash_escaped_operator() {
        let ctx = ValidationContext::new(r"cat file \; echo secret");
        assert!(matches!(
            validate_backslash_escaped_operators(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn brace_expansion_comma() {
        let ctx = ValidationContext::new("echo {a,b,c}");
        assert!(matches!(
            validate_brace_expansion(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn brace_expansion_range() {
        let ctx = ValidationContext::new("echo {1..10}");
        assert!(matches!(
            validate_brace_expansion(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn unicode_whitespace() {
        let ctx = ValidationContext::new("echo\u{00A0}test");
        assert!(matches!(
            validate_unicode_whitespace(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn ansi_c_quoting() {
        let ctx = ValidationContext::new("find . $'\\x2d'exec id");
        assert!(matches!(
            validate_ansi_c_quoting(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn zsh_zmodload() {
        let ctx = ValidationContext::new("zmodload zsh/system");
        assert!(matches!(
            validate_zsh_dangerous_commands(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn eval_keyword() {
        let ctx = ValidationContext::new("eval rm -rf /tmp/x");
        assert!(matches!(validate_eval(&ctx), SecurityVerdict::Warn(_)));
    }

    #[test]
    fn eval_not_substring() {
        let ctx = ValidationContext::new("echo evaluate");
        assert_eq!(validate_eval(&ctx), SecurityVerdict::Allow);
    }

    #[test]
    fn eval_safe_in_single_quotes() {
        let ctx = ValidationContext::new("echo 'eval rm -rf'");
        assert_eq!(validate_eval(&ctx), SecurityVerdict::Allow);
    }

    #[test]
    fn redirections_in_unquoted() {
        let ctx = ValidationContext::new("echo hello > /tmp/out");
        assert!(matches!(
            validate_redirections(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn redirections_safe_in_quotes() {
        let ctx = ValidationContext::new("echo 'hello > world'");
        assert_eq!(validate_redirections(&ctx), SecurityVerdict::Allow);
    }

    // ---- check_command (integration) --------------------------------------

    fn mock_dangerous(cmd: &str) -> Option<&'static str> {
        let trimmed = cmd.trim();
        if trimmed == "rm -rf /" || trimmed == "rm -fr /" {
            Some("Blocked: recursive deletion of root filesystem")
        } else {
            None
        }
    }

    #[test]
    fn compound_catches_hidden_rm() {
        let cmd = "echo safe && rm -rf / && echo done";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Block(msg) => {
                assert!(msg.contains("recursive deletion"));
                assert!(msg.contains("subcommand"));
            }
            other => panic!("expected Block, got {:?}", other),
        }
    }

    #[test]
    fn compound_safe_subcommands() {
        let cmd = "echo a && echo b";
        assert_eq!(check_command(cmd, mock_dangerous), SecurityVerdict::Allow);
    }

    #[test]
    fn compound_with_injection() {
        let cmd = "cd /tmp && echo $(whoami)";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Warn(msg) => assert!(msg.contains("command substitution")),
            other => panic!("expected Warn, got {:?}", other),
        }
    }

    #[test]
    fn compound_dangerous_in_pipe() {
        let cmd = "echo hello | rm -rf /";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Block(msg) => assert!(msg.contains("recursive deletion")),
            other => panic!("expected Block, got {:?}", other),
        }
    }

    #[test]
    fn pipeline_multiple_warnings() {
        let cmd = "eval $(whoami)";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Warn(msg) => {
                assert!(msg.contains("security notice"));
            }
            other => panic!("expected Warn, got {:?}", other),
        }
    }

    #[test]
    fn clean_command_allowed() {
        assert_eq!(
            check_command("ls -la", mock_dangerous),
            SecurityVerdict::Allow
        );
        assert_eq!(
            check_command("echo hello world", mock_dangerous),
            SecurityVerdict::Allow
        );
        assert_eq!(
            check_command("git status", mock_dangerous),
            SecurityVerdict::Allow
        );
        assert_eq!(
            check_command("cargo build --release", mock_dangerous),
            SecurityVerdict::Allow
        );
    }

    #[test]
    fn safe_pipe_allowed() {
        assert_eq!(
            check_command("cat file.txt | grep pattern | wc -l", mock_dangerous),
            SecurityVerdict::Allow
        );
    }

    // ---- AST integration tests -------------------------------------------

    #[test]
    fn ast_find_exec_no_false_positive() {
        // `find -exec \;` should NOT trigger the backslash-escaped-operator
        // warning, because tree-sitter confirms `\;` is a word argument
        // (no actual `;` operator node in the AST).
        let cmd = r"find . -type f -name '*.rs' -exec grep 'TODO' {} \;";
        assert_eq!(check_command(cmd, mock_dangerous), SecurityVerdict::Allow);
    }

    #[test]
    fn ast_real_escaped_semicolon_with_actual_operator_still_warns() {
        // When a REAL `;` operator coexists, the warning should still fire
        // on any `\;` in the command.
        let cmd = r"find . -exec cmd {} \; ; echo done";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Warn(msg) => {
                assert!(msg.contains("security notice"));
            }
            other => panic!("expected Warn, got {:?}", other),
        }
    }

    #[test]
    fn ast_subshell_detected() {
        let cmd = "(cd /tmp && ls)";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Warn(msg) => assert!(msg.contains("subshell")),
            other => panic!("expected Warn about subshell, got {:?}", other),
        }
    }

    #[test]
    fn ast_command_substitution_detected() {
        let cmd = "echo $(whoami)";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Warn(msg) => assert!(msg.contains("security notice")),
            other => panic!("expected Warn, got {:?}", other),
        }
    }

    #[test]
    fn ast_malformed_syntax_detected() {
        let cmd = "echo 'unterminated";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Warn(msg) => assert!(msg.contains("security notice")),
            other => panic!("expected Warn, got {:?}", other),
        }
    }

    // ---- strip_safe_wrappers -----------------------------------------------

    #[test]
    fn strip_timeout_basic() {
        assert_eq!(
            strip_safe_wrappers("timeout 5 npm run build"),
            "npm run build"
        );
    }

    #[test]
    fn strip_timeout_with_suffix() {
        assert_eq!(strip_safe_wrappers("timeout 5s npm start"), "npm start");
        assert_eq!(strip_safe_wrappers("timeout 10m cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout 1h cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout 2d cmd"), "cmd");
    }

    #[test]
    fn strip_timeout_with_decimal() {
        assert_eq!(strip_safe_wrappers("timeout 1.5 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout 0.5s cmd"), "cmd");
    }

    #[test]
    fn strip_timeout_with_flags() {
        assert_eq!(strip_safe_wrappers("timeout --foreground 5 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout --kill-after=5 10 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout --signal TERM 10 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout --signal=KILL 10 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout -k 5 10 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout -k5 10 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("timeout -sTERM 10 cmd"), "cmd");
        assert_eq!(
            strip_safe_wrappers("timeout -v --preserve-status 10 cmd"),
            "cmd"
        );
    }

    #[test]
    fn strip_timeout_with_dashdash() {
        assert_eq!(strip_safe_wrappers("timeout -- 5 cmd"), "cmd");
    }

    #[test]
    fn strip_timeout_rejects_unsafe_flag_value() {
        assert_eq!(
            strip_safe_wrappers("timeout -k$(id) 10 cmd"),
            "timeout -k$(id) 10 cmd"
        );
    }

    #[test]
    fn strip_time() {
        assert_eq!(strip_safe_wrappers("time cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("time -- cmd"), "cmd");
    }

    #[test]
    fn strip_time_does_not_match_timestamp() {
        assert_eq!(strip_safe_wrappers("timestamp cmd"), "timestamp cmd");
    }

    #[test]
    fn strip_nice_bare() {
        assert_eq!(strip_safe_wrappers("nice cmd"), "cmd");
    }

    #[test]
    fn strip_nice_with_priority() {
        assert_eq!(strip_safe_wrappers("nice -n 10 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("nice -n -5 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("nice -10 cmd"), "cmd");
    }

    #[test]
    fn strip_nice_with_dashdash() {
        assert_eq!(strip_safe_wrappers("nice -n 10 -- cmd"), "cmd");
    }

    #[test]
    fn strip_nohup() {
        assert_eq!(strip_safe_wrappers("nohup cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("nohup -- cmd"), "cmd");
    }

    #[test]
    fn strip_stdbuf() {
        assert_eq!(strip_safe_wrappers("stdbuf -o0 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("stdbuf -oL -eL cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("stdbuf -i0 -o0 -e0 cmd"), "cmd");
    }

    #[test]
    fn strip_stdbuf_with_dashdash() {
        assert_eq!(strip_safe_wrappers("stdbuf -o0 -- cmd"), "cmd");
    }

    #[test]
    fn strip_stdbuf_requires_flag() {
        assert_eq!(strip_safe_wrappers("stdbuf cmd"), "stdbuf cmd");
    }

    #[test]
    fn strip_env_var() {
        assert_eq!(strip_safe_wrappers("GOOS=linux go build"), "go build");
        assert_eq!(
            strip_safe_wrappers("NODE_ENV=production npm start"),
            "npm start"
        );
    }

    #[test]
    fn strip_multiple_env_vars() {
        assert_eq!(
            strip_safe_wrappers("GOOS=linux GOARCH=amd64 go build"),
            "go build"
        );
    }

    #[test]
    fn strip_env_plus_wrapper() {
        assert_eq!(
            strip_safe_wrappers("NODE_ENV=production timeout 10 npm start"),
            "npm start"
        );
    }

    #[test]
    fn strip_chained_wrappers() {
        assert_eq!(strip_safe_wrappers("nohup nice -n 10 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("nohup timeout 5 cmd"), "cmd");
        assert_eq!(strip_safe_wrappers("time nohup cmd"), "cmd");
    }

    #[test]
    fn strip_no_op_for_plain_commands() {
        assert_eq!(strip_safe_wrappers("npm run build"), "npm run build");
        assert_eq!(strip_safe_wrappers("ls -la"), "ls -la");
        assert_eq!(strip_safe_wrappers("git status"), "git status");
    }

    #[test]
    fn strip_unsafe_env_var_not_stripped() {
        assert_eq!(
            strip_safe_wrappers("PATH=/evil go build"),
            "PATH=/evil go build"
        );
        assert_eq!(
            strip_safe_wrappers("LD_PRELOAD=evil.so cmd"),
            "LD_PRELOAD=evil.so cmd"
        );
    }

    #[test]
    fn strip_env_with_unsafe_value_not_stripped() {
        assert_eq!(
            strip_safe_wrappers("GOOS=$(whoami) go build"),
            "GOOS=$(whoami) go build"
        );
        assert_eq!(strip_safe_wrappers("NODE_ENV=a;b cmd"), "NODE_ENV=a;b cmd");
    }

    #[test]
    fn strip_does_not_match_across_newlines() {
        assert_eq!(
            strip_safe_wrappers("timeout 5 echo safe\nrm -rf /"),
            "echo safe\nrm -rf /"
        );
    }

    // ---- wrapper stripping + dangerous pattern integration -----------------

    #[test]
    fn wrapper_stripped_catches_dangerous() {
        let cmd = "timeout 5 rm -rf /";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Block(msg) => {
                assert!(msg.contains("recursive deletion"));
                assert!(msg.contains("normalizing wrappers"));
            }
            other => panic!("expected Block, got {:?}", other),
        }
    }

    #[test]
    fn env_stripped_catches_dangerous() {
        let cmd = "NODE_ENV=prod rm -rf /";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Block(msg) => assert!(msg.contains("recursive deletion")),
            other => panic!("expected Block, got {:?}", other),
        }
    }

    #[test]
    fn wrapper_stripped_in_subcommand_catches_dangerous() {
        let cmd = "echo ok && timeout 5 rm -rf /";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Block(msg) => {
                assert!(msg.contains("recursive deletion"));
                assert!(msg.contains("subcommand"));
            }
            other => panic!("expected Block, got {:?}", other),
        }
    }

    #[test]
    fn nohup_wrapped_dangerous_caught() {
        let cmd = "nohup rm -rf /";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Block(msg) => assert!(msg.contains("recursive deletion")),
            other => panic!("expected Block, got {:?}", other),
        }
    }

    #[test]
    fn chained_wrapper_dangerous_caught() {
        let cmd = "nohup nice -n 10 rm -rf /";
        match check_command(cmd, mock_dangerous) {
            SecurityVerdict::Block(msg) => assert!(msg.contains("recursive deletion")),
            other => panic!("expected Block, got {:?}", other),
        }
    }

    #[test]
    fn zsh_dangerous_after_wrapper() {
        let ctx = ValidationContext::new("nohup zmodload zsh/system");
        assert!(matches!(
            validate_zsh_dangerous_commands(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }

    #[test]
    fn zsh_dangerous_after_env_var() {
        let ctx = ValidationContext::new("NODE_ENV=prod zmodload zsh/system");
        assert!(matches!(
            validate_zsh_dangerous_commands(&ctx),
            SecurityVerdict::Warn(_)
        ));
    }
}
