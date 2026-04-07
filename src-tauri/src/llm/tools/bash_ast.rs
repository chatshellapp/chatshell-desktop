//! AST-based bash command security analysis using tree-sitter.
//!
//! Parses bash commands into an AST and extracts security-relevant structure
//! that regex/character scanners cannot reliably detect. The key advantage is
//! that tree-sitter understands bash grammar, so it correctly distinguishes:
//! - Escaped operators (`\;` is a word, not a separator)
//! - Quoted content (no false positives from patterns inside quotes)
//! - Nested structures (command substitution depth, subshells)
//! - Actual compound operators vs arguments that look like operators

use tree_sitter::{Node, Parser};

const MAX_COMMAND_LENGTH: usize = 10_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Complete AST-based analysis of a bash command.
#[derive(Debug, Clone)]
pub struct AstAnalysis {
    pub compound: CompoundStructure,
    pub dangerous: DangerousPatterns,
    /// True when tree-sitter finds actual `;`, `&&`, `||` operator nodes
    /// (not `\;` which is a word argument).
    pub has_actual_operators: bool,
    /// True when the parse contained ERROR nodes (malformed syntax).
    pub has_parse_errors: bool,
}

/// Compound command structure extracted from the AST.
#[derive(Debug, Clone, Default)]
pub struct CompoundStructure {
    /// Top-level compound operators (`&&`, `||`, `;`).
    pub operators: Vec<String>,
    /// Individual command segments split by operators/pipes.
    pub segments: Vec<String>,
    pub has_pipeline: bool,
    pub has_subshell: bool,
    pub has_command_group: bool,
}

/// Dangerous patterns detected via AST node types.
#[derive(Debug, Clone, Default)]
pub struct DangerousPatterns {
    pub has_command_substitution: bool,
    pub has_process_substitution: bool,
    pub has_parameter_expansion: bool,
    pub has_heredoc: bool,
    pub has_comment: bool,
}

// ---------------------------------------------------------------------------
// Parser (thread-local for reuse)
// ---------------------------------------------------------------------------

thread_local! {
    static PARSER: std::cell::RefCell<Option<Parser>> = const { std::cell::RefCell::new(None) };
}

fn with_parser<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut Parser) -> R,
{
    PARSER.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            let mut parser = Parser::new();
            if parser
                .set_language(&tree_sitter_bash::LANGUAGE.into())
                .is_err()
            {
                return None;
            }
            *slot = Some(parser);
        }
        slot.as_mut().map(f)
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Parse a command and perform full AST analysis.
/// Returns `None` if the command is too long or the parser is unavailable.
pub fn analyze(command: &str) -> Option<AstAnalysis> {
    if command.is_empty() || command.len() > MAX_COMMAND_LENGTH {
        return None;
    }

    with_parser(|parser| {
        let tree = parser.parse(command, None)?;
        let root = tree.root_node();

        let has_parse_errors = has_error_nodes(root);
        let compound = extract_compound_structure(root, command);
        let dangerous = extract_dangerous_patterns(root);
        let has_actual_operators = check_actual_operators(root);

        Some(AstAnalysis {
            compound,
            dangerous,
            has_actual_operators,
            has_parse_errors,
        })
    })
    .flatten()
}

// ---------------------------------------------------------------------------
// Compound structure extraction
// ---------------------------------------------------------------------------

fn extract_compound_structure(root: Node, command: &str) -> CompoundStructure {
    let mut result = CompoundStructure::default();
    walk_top_level(root, command, &mut result);
    if result.segments.is_empty() {
        result.segments.push(command.to_string());
    }
    result
}

fn walk_top_level(node: Node, command: &str, out: &mut CompoundStructure) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "list" => walk_list(child, command, out),
            ";" => out.operators.push(";".into()),
            "pipeline" => {
                out.has_pipeline = true;
                out.segments.push(node_text(child, command).into());
            }
            "subshell" => {
                out.has_subshell = true;
                out.segments.push(node_text(child, command).into());
            }
            "compound_statement" => {
                out.has_command_group = true;
                out.segments.push(node_text(child, command).into());
            }
            "command" | "declaration_command" | "variable_assignment" => {
                out.segments.push(node_text(child, command).into());
            }
            "redirected_statement" => {
                let mut found_inner = false;
                let mut inner_cursor = child.walk();
                for inner in child.children(&mut inner_cursor) {
                    if inner.kind() == "file_redirect" || inner.kind() == "heredoc_redirect" {
                        continue;
                    }
                    found_inner = true;
                    walk_top_level(inner, command, out);
                }
                if !found_inner {
                    out.segments.push(node_text(child, command).into());
                }
            }
            "negated_command" => {
                out.segments.push(node_text(child, command).into());
                walk_top_level(child, command, out);
            }
            "if_statement"
            | "while_statement"
            | "for_statement"
            | "case_statement"
            | "function_definition" => {
                out.segments.push(node_text(child, command).into());
                walk_top_level(child, command, out);
            }
            _ => {}
        }
    }
}

fn walk_list(node: Node, command: &str, out: &mut CompoundStructure) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "&&" | "||" => out.operators.push(child.kind().into()),
            "list" | "redirected_statement" => {
                walk_top_level(node_as_parent(child), command, out);
            }
            "pipeline" => {
                out.has_pipeline = true;
                out.segments.push(node_text(child, command).into());
            }
            "subshell" => {
                out.has_subshell = true;
                out.segments.push(node_text(child, command).into());
            }
            "compound_statement" => {
                out.has_command_group = true;
                out.segments.push(node_text(child, command).into());
            }
            _ => {
                out.segments.push(node_text(child, command).into());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Dangerous pattern detection
// ---------------------------------------------------------------------------

fn extract_dangerous_patterns(root: Node) -> DangerousPatterns {
    let mut result = DangerousPatterns::default();
    walk_dangerous(root, &mut result);
    result
}

fn walk_dangerous(node: Node, out: &mut DangerousPatterns) {
    match node.kind() {
        "command_substitution" => out.has_command_substitution = true,
        "process_substitution" => out.has_process_substitution = true,
        "expansion" => out.has_parameter_expansion = true,
        "heredoc_redirect" => out.has_heredoc = true,
        "comment" => out.has_comment = true,
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_dangerous(child, out);
    }
}

// ---------------------------------------------------------------------------
// Actual operator detection
// ---------------------------------------------------------------------------

/// Check if the AST contains actual operator nodes (`;`, `&&`, `||`).
/// Tree-sitter parses `\;` as part of a `word` node, NOT as a `;` operator.
fn check_actual_operators(root: Node) -> bool {
    walk_for_operators(root)
}

fn walk_for_operators(node: Node) -> bool {
    match node.kind() {
        ";" | "&&" | "||" => return true,
        "list" => return true,
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if walk_for_operators(child) {
            return true;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Error node detection
// ---------------------------------------------------------------------------

fn has_error_nodes(root: Node) -> bool {
    walk_for_errors(root)
}

fn walk_for_errors(node: Node) -> bool {
    if node.is_error() || node.is_missing() {
        return true;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if walk_for_errors(child) {
            return true;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn node_text<'a>(node: Node, source: &'a str) -> &'a str {
    &source[node.byte_range()]
}

/// Wraps a child node so we can call walk_top_level on it.
/// Since walk_top_level iterates over children, we pass the node itself
/// as if it were a parent — the function will iterate its children.
fn node_as_parent(node: Node) -> Node {
    node
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_command() {
        let a = analyze("echo hello").unwrap();
        assert!(!a.has_parse_errors);
        assert!(!a.has_actual_operators);
        assert!(!a.dangerous.has_command_substitution);
        assert_eq!(a.compound.segments.len(), 1);
    }

    #[test]
    fn compound_and() {
        let a = analyze("cd /tmp && ls -la").unwrap();
        assert!(a.has_actual_operators);
        assert!(a.compound.operators.contains(&"&&".to_string()));
        assert!(a.compound.segments.len() >= 2);
    }

    #[test]
    fn compound_semicolon() {
        let a = analyze("echo a; echo b").unwrap();
        assert!(a.has_actual_operators);
        assert!(a.compound.segments.len() >= 2);
    }

    #[test]
    fn escaped_semicolon_is_not_operator() {
        let a = analyze(r"find . -name '*.txt' -exec rm {} \;").unwrap();
        assert!(
            !a.has_actual_operators,
            "\\; should not be an actual operator"
        );
    }

    #[test]
    fn pipeline() {
        let a = analyze("cat file | grep foo | wc -l").unwrap();
        assert!(a.compound.has_pipeline);
    }

    #[test]
    fn command_substitution() {
        let a = analyze("echo $(whoami)").unwrap();
        assert!(a.dangerous.has_command_substitution);
    }

    #[test]
    fn command_substitution_in_single_quotes_still_parsed() {
        // tree-sitter sees the raw_string, but $(whoami) inside is literal
        // The key point: tree-sitter does NOT create a command_substitution node
        // inside single quotes (it's raw_string content).
        let a = analyze("echo '$(whoami)'").unwrap();
        assert!(
            !a.dangerous.has_command_substitution,
            "single-quoted $() should not be command substitution"
        );
    }

    #[test]
    fn command_substitution_in_double_quotes() {
        let a = analyze(r#"echo "$(whoami)""#).unwrap();
        assert!(a.dangerous.has_command_substitution);
    }

    #[test]
    fn process_substitution() {
        let a = analyze("diff <(ls dir1) <(ls dir2)").unwrap();
        assert!(a.dangerous.has_process_substitution);
    }

    #[test]
    fn parameter_expansion() {
        let a = analyze("echo ${HOME}").unwrap();
        assert!(a.dangerous.has_parameter_expansion);
    }

    #[test]
    fn heredoc() {
        let a = analyze("cat <<EOF\nhello\nEOF").unwrap();
        assert!(a.dangerous.has_heredoc);
    }

    #[test]
    fn subshell() {
        let a = analyze("(cd /tmp && ls)").unwrap();
        assert!(a.compound.has_subshell);
    }

    #[test]
    fn command_group() {
        let a = analyze("{ echo a; echo b; }").unwrap();
        assert!(a.compound.has_command_group);
    }

    #[test]
    fn comment() {
        let a = analyze("echo hello # this is a comment").unwrap();
        assert!(a.dangerous.has_comment);
    }

    #[test]
    fn parse_error() {
        let a = analyze("echo 'unterminated").unwrap();
        assert!(a.has_parse_errors);
    }

    #[test]
    fn empty_returns_none() {
        assert!(analyze("").is_none());
    }

    #[test]
    fn too_long_returns_none() {
        let long = "a".repeat(MAX_COMMAND_LENGTH + 1);
        assert!(analyze(&long).is_none());
    }

    #[test]
    fn backtick_substitution() {
        let a = analyze("echo `whoami`").unwrap();
        assert!(a.dangerous.has_command_substitution);
    }

    #[test]
    fn if_statement() {
        let a = analyze("if true; then echo yes; fi").unwrap();
        assert!(a.has_actual_operators);
        assert!(!a.compound.segments.is_empty());
    }

    #[test]
    fn nested_substitution() {
        let a = analyze("echo $(echo $(date))").unwrap();
        assert!(a.dangerous.has_command_substitution);
    }

    #[test]
    fn real_world_safe() {
        let a = analyze("git status && cargo build --release").unwrap();
        assert!(a.has_actual_operators);
        assert!(!a.dangerous.has_command_substitution);
        assert!(!a.compound.has_subshell);
    }

    #[test]
    fn real_world_find_exec() {
        let a = analyze(r"find . -type f -name '*.rs' -exec grep 'TODO' {} \;").unwrap();
        assert!(!a.has_actual_operators);
        assert!(!a.dangerous.has_command_substitution);
    }
}
