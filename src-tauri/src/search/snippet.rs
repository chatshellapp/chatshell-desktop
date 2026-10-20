use regex::Regex;

const SNIPPET_CONTEXT_LINES: usize = 1;
const SNIPPET_MAX_LINES: usize = 6;
const SNIPPET_MAX_LINE_LENGTH: usize = 120;
const SNIPPET_LINE_FRAGMENT_RADIUS: usize = 40;
const SNIPPET_MAX_LINE_FRAGMENTS: usize = 3;

fn floor_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut i = index;
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut i = index;
    while !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

fn strip_markdown(text: &str) -> String {
    let t = text
        .replace("```", "\n")
        .replace("**", "")
        .replace('*', "")
        .replace("__", "")
        .replace('_', "");
    // Remove ![alt](url) and [text](url) - keep alt/text
    let link_img = Regex::new(r"!?\[([^\]]*)\]\([^)]*\)").ok();
    let t = match &link_img {
        Some(re) => re.replace_all(&t, "$1").to_string(),
        None => t,
    };
    // Remove inline `code`
    let inline_code = Regex::new(r"`([^`]*)`").ok();
    let t = match &inline_code {
        Some(re) => re.replace_all(&t, "$1").to_string(),
        None => t,
    };
    // Remove # headings
    let headings = Regex::new(r"^#+\s*").ok();
    let t = match &headings {
        Some(re) => re.replace_all(&t, "").to_string(),
        None => t,
    };
    t.replace("<", "&lt;").replace(">", "&gt;")
}

fn normalize_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn merge_ranges(mut ranges: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    ranges.sort_by(|a, b| a.0.cmp(&b.0));
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in ranges {
        if let Some(last) = merged.last_mut()
            && start <= last.1 + 1
        {
            last.1 = last.1.max(end);
            continue;
        }
        merged.push((start, end));
    }
    merged
}

/// Build a snippet from content with query terms highlighted by <mark>.
pub fn build_snippet(
    content: &str,
    query_terms: &[String],
    max_lines: usize,
    context_lines: usize,
    max_line_length: usize,
) -> String {
    let max_lines = max_lines.min(SNIPPET_MAX_LINES);
    let context_lines = context_lines.min(SNIPPET_CONTEXT_LINES);
    let max_line_length = max_line_length.min(SNIPPET_MAX_LINE_LENGTH);

    let normalized = normalize_text(&strip_markdown(content));
    let lines: Vec<&str> = normalized.lines().collect();
    if lines.is_empty() {
        return String::new();
    }

    let non_empty_terms: Vec<&str> = query_terms
        .iter()
        .map(|s| s.as_str())
        .filter(|s| !s.trim().is_empty())
        .collect();

    let mut matched_line_indexes: Vec<usize> = Vec::new();
    if !non_empty_terms.is_empty() {
        for (i, line) in lines.iter().enumerate() {
            let line_lower = line.to_lowercase();
            if non_empty_terms
                .iter()
                .any(|t| line_lower.contains(&t.to_lowercase()))
            {
                matched_line_indexes.push(i);
            }
        }
    }

    let ranges: Vec<(usize, usize)> = if matched_line_indexes.is_empty() {
        vec![(0, (lines.len() - 1).min(max_lines.saturating_sub(1)))]
    } else {
        let expanded: Vec<(usize, usize)> = matched_line_indexes
            .into_iter()
            .map(|idx| {
                (
                    idx.saturating_sub(context_lines),
                    (idx + context_lines).min(lines.len().saturating_sub(1)),
                )
            })
            .collect();
        merge_ranges(expanded)
    };

    let mut output_lines: Vec<String> = Vec::new();
    if ranges.first().map(|r| r.0) > Some(0) {
        output_lines.push("...".to_string());
    }

    for (start, end) in &ranges {
        if output_lines.len() >= max_lines {
            break;
        }
        if !output_lines.is_empty() && output_lines.last().map(|s| s.as_str()) != Some("...") {
            output_lines.push("...".to_string());
        }
        for i in *start..=*end {
            if output_lines.len() >= max_lines {
                break;
            }
            let line = lines.get(i).copied().unwrap_or("");
            let snippet_line = build_line_snippet(line, &non_empty_terms, max_line_length);
            output_lines.push(snippet_line);
        }
    }

    let last_end = ranges.last().map(|r| r.1).unwrap_or(0);
    if (output_lines.len() >= max_lines || last_end < lines.len().saturating_sub(1))
        && output_lines.last().map(|s| s.as_str()) != Some("...")
    {
        output_lines.push("...".to_string());
    }

    let plain = output_lines.join("\n");
    highlight_terms(&plain, &non_empty_terms)
}

fn build_line_snippet(line: &str, terms: &[&str], max_len: usize) -> String {
    if line.len() <= max_len {
        return line.to_string();
    }

    let line_lower = line.to_lowercase();
    let mut match_ranges: Vec<(usize, usize)> = Vec::new();
    for term in terms {
        let t_lower = term.to_lowercase();
        let mut start = 0;
        while let Some(pos) = line_lower[start..].find(&t_lower) {
            let abs_start = start + pos;
            let abs_end = abs_start + t_lower.len();
            match_ranges.push((abs_start, abs_end));
            start = abs_end;
        }
    }

    if match_ranges.is_empty() {
        let truncate_at = floor_char_boundary(line, max_len);
        return format!("{}...", &line[..truncate_at]);
    }

    let expanded: Vec<(usize, usize)> = match_ranges
        .into_iter()
        .map(|(s, e)| {
            (
                floor_char_boundary(line, s.saturating_sub(SNIPPET_LINE_FRAGMENT_RADIUS)),
                ceil_char_boundary(line, (e + SNIPPET_LINE_FRAGMENT_RADIUS).min(line.len())),
            )
        })
        .collect();
    let merged = merge_ranges(expanded);
    let limited = merged
        .into_iter()
        .take(SNIPPET_MAX_LINE_FRAGMENTS)
        .collect::<Vec<_>>();

    let result: Vec<String> = limited
        .iter()
        .map(|(s, e)| line[*s..*e].to_string())
        .collect();
    let result_joined = result.join(" ... ");
    let mut out = result_joined;
    if let Some(&(s, _)) = limited.first()
        && s > 0
    {
        out = format!("...{}", out);
    }
    if let Some(&(_, e)) = limited.last()
        && e < line.len()
    {
        out = format!("{}...", out);
    }
    if out.len() > max_len {
        let truncate_at = floor_char_boundary(&out, max_len);
        out = format!("{}...", &out[..truncate_at]);
    }
    out
}

fn highlight_terms(text: &str, terms: &[&str]) -> String {
    if terms.is_empty() {
        return text.to_string();
    }
    let mut out = text.to_string();
    for term in terms {
        let replacement = format!("<mark>{}</mark>", escape_html(term));
        out = replace_ignore_case(&out, term, &replacement);
    }
    out
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn replace_ignore_case(haystack: &str, needle: &str, replacement: &str) -> String {
    let mut result = String::with_capacity(haystack.len());
    let needle_lower: Vec<char> = needle.to_lowercase().chars().collect();
    let haystack_lower = haystack.to_lowercase();
    let haystack_chars: Vec<char> = haystack.chars().collect();
    let haystack_lower_chars: Vec<char> = haystack_lower.chars().collect();
    let n = needle_lower.len();
    // A needle longer than the haystack can never match (and previously
    // panicked on the window slice); an empty needle would loop forever.
    if n == 0 || haystack_chars.len() < n {
        return haystack.to_string();
    }
    let mut i = 0;
    while i <= haystack_chars.len().saturating_sub(n) {
        let window: Vec<char> = haystack_lower_chars[i..i + n].to_vec();
        if window == needle_lower {
            result.push_str(replacement);
            i += n;
            continue;
        }
        result.push(haystack_chars[i]);
        i += 1;
    }
    while i < haystack_chars.len() {
        result.push(haystack_chars[i]);
        i += 1;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn terms(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn floor_char_boundary_snaps_to_char_start() {
        // "héllo": h=1B, é=2B (1..3), l=1, l=1, o=1 -> len 6.
        assert_eq!(floor_char_boundary("héllo", 0), 0);
        assert_eq!(floor_char_boundary("héllo", 1), 1);
        assert_eq!(floor_char_boundary("héllo", 2), 1);
        assert_eq!(floor_char_boundary("héllo", 3), 3);
        assert_eq!(floor_char_boundary("héllo", 6), 6);
        assert_eq!(floor_char_boundary("héllo", 10), 6);
        // "a🙂b": a=1B, 🙂=4B (1..5), b=1B -> len 6.
        assert_eq!(floor_char_boundary("a🙂b", 3), 1);
        assert_eq!(floor_char_boundary("a🙂b", 5), 5);
    }

    #[test]
    fn ceil_char_boundary_snaps_to_char_end() {
        assert_eq!(ceil_char_boundary("héllo", 2), 3);
        assert_eq!(ceil_char_boundary("héllo", 1), 1);
        assert_eq!(ceil_char_boundary("héllo", 6), 6);
        assert_eq!(ceil_char_boundary("héllo", 10), 6);
        assert_eq!(ceil_char_boundary("a🙂b", 3), 5);
        assert_eq!(ceil_char_boundary("a🙂b", 5), 5);
        assert_eq!(ceil_char_boundary("a🙂b", 9), 6);
    }

    #[test]
    fn strip_markdown_removes_formatting_and_escapes_angle_brackets() {
        assert_eq!(
            strip_markdown("```rust\nfn main() {}\n```"),
            "\nrust\nfn main() {}\n\n"
        );
        assert_eq!(strip_markdown("# Heading"), "Heading");
        assert_eq!(strip_markdown("**bold** *ital* __u__ _v_"), "bold ital u v");
        assert_eq!(
            strip_markdown("![alt](http://img) [text](http://x)"),
            "alt text"
        );
        assert_eq!(strip_markdown("a `code` b"), "a code b");
        assert_eq!(strip_markdown("x < y > z"), "x &lt; y &gt; z");
    }

    #[test]
    fn normalize_text_converts_all_line_endings() {
        assert_eq!(normalize_text("a\r\nb\rc\nd"), "a\nb\nc\nd");
        assert_eq!(normalize_text("unchanged"), "unchanged");
    }

    #[test]
    fn merge_ranges_sorts_overlaps_and_adjacent_gaps() {
        assert_eq!(merge_ranges(vec![]), Vec::<(usize, usize)>::new());
        // Unsorted input with overlap: (1,3)+(3,4)+(5,8) coalesce via adjacency.
        assert_eq!(merge_ranges(vec![(5, 8), (1, 3), (3, 4)]), vec![(1, 8)]);
        // Gap of one line still merges (start <= last.1 + 1).
        assert_eq!(merge_ranges(vec![(0, 1), (2, 3)]), vec![(0, 3)]);
        // Real gaps stay separate.
        assert_eq!(merge_ranges(vec![(0, 1), (3, 5)]), vec![(0, 1), (3, 5)]);
    }

    #[test]
    fn build_snippet_empty_content_returns_empty_string() {
        assert_eq!(build_snippet("", &terms(&["term"]), 6, 1, 120), "");
    }

    #[test]
    fn build_snippet_without_matches_returns_head_lines() {
        let out = build_snippet("l0\nl1\nl2\nl3", &terms(&["zzz"]), 6, 1, 120);
        assert_eq!(out, "l0\nl1\nl2\nl3");
    }

    #[test]
    fn build_snippet_without_matches_caps_at_max_lines() {
        let content = (0..10)
            .map(|i| format!("l{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let out = build_snippet(&content, &terms(&["zzz"]), 3, 1, 120);
        assert_eq!(out, "l0\nl1\nl2\n...");
    }

    #[test]
    fn build_snippet_highlights_matches_case_insensitively_across_gap() {
        let content = "one MATCH two\nx\ny\nz\nanother MATCH end";
        let out = build_snippet(content, &terms(&["match"]), 6, 1, 120);
        assert_eq!(
            out,
            "one <mark>match</mark> two\nx\n...\nz\nanother <mark>match</mark> end"
        );
    }

    #[test]
    fn build_snippet_blank_terms_fall_back_to_head_lines() {
        let out = build_snippet("a\nb\nMATCH\nc", &terms(&["", "   "]), 6, 1, 120);
        assert_eq!(out, "a\nb\nMATCH\nc");
    }

    #[test]
    fn build_snippet_clamps_context_lines_to_one() {
        let content = "one\ntwo\nthree\nfour hit\nfive\nsix\nseven\neight";
        let out = build_snippet(content, &terms(&["hit"]), 6, 5, 120);
        // context_lines=5 is clamped to 1: only lines 2..=4 plus ellipses.
        assert_eq!(out, "...\nthree\nfour <mark>hit</mark>\nfive\n...");
    }

    #[test]
    fn build_snippet_clamps_max_lines_to_six() {
        let content = (1..=8)
            .map(|i| format!("hit {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let out = build_snippet(&content, &terms(&["hit"]), 100, 1, 120);
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 7); // 6 content lines + trailing ellipsis
        for line in &lines[..6] {
            assert!(
                line.starts_with("<mark>hit</mark>"),
                "line not highlighted: {line}"
            );
        }
        assert_eq!(lines[6], "...");
    }

    #[test]
    fn build_snippet_clamps_max_line_length_to_120() {
        let content = "a".repeat(150);
        let out = build_snippet(&content, &[], 6, 1, 1000);
        assert_eq!(out.len(), 123);
        assert!(out.ends_with("..."));
    }

    #[test]
    fn build_line_snippet_returns_short_line_unchanged() {
        assert_eq!(
            build_line_snippet("hello world", &["world"], 120),
            "hello world"
        );
        assert_eq!(build_line_snippet("hello", &[], 120), "hello");
    }

    #[test]
    fn build_line_snippet_truncates_long_line_without_matches() {
        let line = "a".repeat(150);
        let out = build_line_snippet(&line, &[], 120);
        assert_eq!(out, format!("{}...", "a".repeat(120)));
    }

    #[test]
    fn build_line_snippet_truncation_respects_char_boundaries() {
        // é is 2 bytes; 121 is mid-char, so the cut backs off to 120.
        let line = "é".repeat(100);
        let out = build_line_snippet(&line, &[], 121);
        assert_eq!(out.len(), 123);
        assert!(out.ends_with("..."));
        assert_eq!(out.chars().count(), 63); // 60 é + "..."
    }

    #[test]
    fn build_line_snippet_extracts_fragment_around_match() {
        let line = format!("{}needle{}", "x".repeat(60), "y".repeat(60));
        let out = build_line_snippet(&line, &["needle"], 120);
        // Fragment window is match ± 40 bytes: line[20..106] plus ellipses.
        assert!(out.starts_with("..."));
        assert!(out.ends_with("..."));
        assert!(out.contains("needle"));
        assert_eq!(out.len(), 3 + 86 + 3);
        assert_eq!(out.matches(" ... ").count(), 0);
    }

    #[test]
    fn build_line_snippet_merges_nearby_matches_into_one_fragment() {
        let line = format!(
            "{}needle{}needle{}",
            "x".repeat(60),
            "m".repeat(30),
            "y".repeat(60)
        );
        // max_len below the 162-byte line keeps the fragment path active.
        let out = build_line_snippet(&line, &["needle"], 160);
        assert_eq!(out.matches(" ... ").count(), 0);
        assert_eq!(out.matches("needle").count(), 2);
        assert!(out.starts_with("..."));
        assert!(out.ends_with("..."));
    }

    #[test]
    fn build_line_snippet_caps_fragments_at_three() {
        let line = format!(
            "{}needle{}needle{}needle{}needle{}",
            "a".repeat(94),
            "b".repeat(94),
            "c".repeat(94),
            "d".repeat(94),
            "e".repeat(94)
        );
        // max_len below the 494-byte line keeps the fragment path active;
        // the joined fragments (274 bytes) fit without final truncation.
        let out = build_line_snippet(&line, &["needle"], 300);
        // Only the first three matches survive the fragment cap.
        assert_eq!(out.matches(" ... ").count(), 2);
        assert_eq!(out.matches("needle").count(), 3);
        assert_eq!(out.len(), 3 + 86 + 5 + 86 + 5 + 86 + 3);
    }

    #[test]
    fn build_line_snippet_truncates_oversized_fragment_output() {
        let line = format!(
            "{}needle{}needle{}needle{}needle{}",
            "a".repeat(94),
            "b".repeat(94),
            "c".repeat(94),
            "d".repeat(94),
            "e".repeat(94)
        );
        let out = build_line_snippet(&line, &["needle"], 120);
        assert!(out.starts_with("..."));
        assert!(out.ends_with("..."));
        assert_eq!(out.len(), 123);
    }

    #[test]
    fn build_line_snippet_handles_multibyte_matches() {
        let line = format!("{}針{}", "日".repeat(50), "日".repeat(50));
        let out = build_line_snippet(&line, &["針"], 120);
        assert!(out.contains("針"));
        assert!(out.starts_with("..."));
        assert!(out.ends_with("..."));
        assert_eq!(out.len(), 3 + 87 + 3); // fragment is 29 chars = 87 bytes
    }

    #[test]
    fn highlight_terms_without_terms_returns_text_unchanged() {
        assert_eq!(highlight_terms("abc", &[]), "abc");
    }

    #[test]
    fn highlight_terms_wraps_all_case_insensitive_matches() {
        assert_eq!(
            highlight_terms("Hello WORLD foo", &["world"]),
            "Hello <mark>world</mark> foo"
        );
        assert_eq!(
            highlight_terms("alpha beta", &["alpha", "beta"]),
            "<mark>alpha</mark> <mark>beta</mark>"
        );
    }

    #[test]
    fn highlight_terms_escapes_term_html() {
        assert_eq!(
            highlight_terms("x A&B y", &["a&b"]),
            "x <mark>a&amp;b</mark> y"
        );
    }

    #[test]
    fn escape_html_replaces_all_entities() {
        assert_eq!(escape_html("a&<>\""), "a&amp;&lt;&gt;&quot;");
    }

    #[test]
    fn replace_ignore_case_replaces_every_match() {
        assert_eq!(
            replace_ignore_case("a Foo B foo c", "foo", "X"),
            "a X B X c"
        );
        // Non-ASCII case folding.
        assert_eq!(replace_ignore_case("ÇA va", "ça", "X"), "X va");
        // Match at the very end of the haystack.
        assert_eq!(
            replace_ignore_case("say foo", "foo", "<mark>foo</mark>"),
            "say <mark>foo</mark>"
        );
        // Needle absent -> haystack unchanged.
        assert_eq!(replace_ignore_case("abc", "zz", "X"), "abc");
    }

    #[test]
    fn replace_ignore_case_handles_degenerate_needle_lengths() {
        // Regression: a query term longer than the snippet text used to
        // panic on the window slice (reachable from build_snippet).
        assert_eq!(replace_ignore_case("hi", "a-very-long-term", "X"), "hi");
        // Empty needle would have looped forever; upstream filters blank
        // terms, but the helper stays total.
        assert_eq!(replace_ignore_case("abc", "", "X"), "abc");
    }
}
