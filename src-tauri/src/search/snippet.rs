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
            && start <= last.1 + 1 {
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
        && s > 0 {
            out = format!("...{}", out);
        }
    if let Some(&(_, e)) = limited.last()
        && e < line.len() {
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
