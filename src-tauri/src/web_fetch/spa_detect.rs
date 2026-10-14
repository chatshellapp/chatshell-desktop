//! Detection of JavaScript-shell pages fetched over plain HTTP.
//!
//! A JS-dependent page can answer 200 with a static shell: Readability
//! extracts nav/footer fragments, the result is marked successful, and the
//! model silently receives incomplete content. `fetch_web_resource` uses
//! [`looks_like_js_shell`] as a third fallback trigger alongside network
//! errors and non-2xx statuses (fetcher.rs).
//!
//! The signals are deliberately high-precision: a false positive costs one
//! extra browser fetch (seconds); a false negative costs the model trusting
//! incomplete content. Semantically-incomplete-but-structurally-normal pages
//! are out of scope — no static check can catch those.

use std::sync::LazyLock;

use regex::Regex;

/// Extracted-content ceiling for escalation. JS shells usually yield nav and
/// footer fragments well under this; real articles exceed it by far.
const MAX_EXTRACTED_CHARS: usize = 2000;

/// Script spans must cover at least this fraction of the HTML bytes.
const SCRIPT_FRACTION_MIN: f64 = 0.5;

/// Empty `<div>` mount points whose id marks a client-rendered app. SSR
/// variants ship full markup into the same ids and do not match.
static EMPTY_MOUNT_POINT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<div\b[^>]*\bid\s*=\s*["'](?:root|app|__next|__nuxt|q-app)["'][^>]*?(?:/>|>\s*</div>)"#,
    )
    .unwrap()
});

/// Content under this many chars counts as a JS-gate page when it carries a
/// gate phrase (content under 1024 chars).
const JS_GATE_MAX_CHARS: usize = 1024;

/// Phrases bot-walls and JS-required interstitials use.
const JS_GATE_PHRASES: [&str; 5] = [
    "enable javascript",
    "javascript required",
    "turn on javascript",
    "please enable javascript",
    "browser not supported",
];

/// Navigation-shell shape: more than this many non-empty lines …
const NAV_MIN_LINES: usize = 10;
/// … with more than this fraction shorter than `NAV_SHORT_LINE_MAX_CHARS`.
const NAV_SHORT_LINE_FRACTION: f64 = 0.7;
const NAV_SHORT_LINE_MAX_CHARS: usize = 40;

/// Whether the *extracted markdown* reads like a low-quality page: a JS-gate
/// interstitial or a mostly-navigation shell.
/// Complements [`looks_like_js_shell`], which judges the input HTML
/// structure; the fetcher ORs both at its single escalation point.
pub(crate) fn has_low_quality_text(markdown: &str) -> bool {
    has_js_gate_phrase(markdown) || is_navigation_density(markdown)
}

fn has_js_gate_phrase(content: &str) -> bool {
    if content.chars().count() >= JS_GATE_MAX_CHARS {
        return false;
    }
    let lower = content.to_lowercase();
    JS_GATE_PHRASES.iter().any(|phrase| lower.contains(phrase))
}

fn is_navigation_density(content: &str) -> bool {
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() <= NAV_MIN_LINES {
        return false;
    }
    let short_lines = lines
        .iter()
        .filter(|l| l.trim().chars().count() < NAV_SHORT_LINE_MAX_CHARS)
        .count();
    (short_lines as f64 / lines.len() as f64) > NAV_SHORT_LINE_FRACTION
}

static SCRIPT_SPAN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<script\b[^>]*>.*?</script>").unwrap());

/// Whether the HTML looks like a JavaScript shell rather than a complete
/// document. `extracted_chars` is the pre-truncation extraction length
/// (Readability markdown, or body fallback when extraction failed).
pub(crate) fn looks_like_js_shell(html: &str, extracted_chars: usize) -> bool {
    if extracted_chars >= MAX_EXTRACTED_CHARS {
        return false;
    }
    EMPTY_MOUNT_POINT.is_match(html) || script_fraction(html) >= SCRIPT_FRACTION_MIN
}

/// Share of the HTML covered by `<script>…</script>` spans, in bytes.
fn script_fraction(html: &str) -> f64 {
    if html.is_empty() {
        return 0.0;
    }
    let script_bytes: usize = SCRIPT_SPAN.find_iter(html).map(|m| m.len()).sum();
    script_bytes as f64 / html.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    const SSR_ARTICLE: &str = r#"<html><body><div id="__next"><main>
        <h1>Real Article</h1><p>Long meaningful text</p>
        <!-- ... thousands of chars of server-rendered markup ... -->
    </main></div>
    <script>window.__DATA__ = {"props": 1}</script></body></html>"#;

    #[test]
    fn empty_root_mount_point_is_a_shell() {
        let html = r#"<html><body><div id="root"></div>
            <script src="/app.js"></script></body></html>"#;
        assert!(looks_like_js_shell(html, 120));
    }

    #[test]
    fn self_closing_mount_point_is_a_shell() {
        let html = r#"<body><div id="app"/><noscript>Enable JavaScript</noscript></body>"#;
        assert!(looks_like_js_shell(html, 80));
    }

    #[test]
    fn whitespace_only_mount_point_is_a_shell() {
        let html = r#"<body><div id="root">
        </div></body>"#;
        assert!(looks_like_js_shell(html, 50));
    }

    #[test]
    fn ssr_page_with_mount_point_and_long_text_is_not_a_shell() {
        // The mount div carries full markup, and extraction is long anyway.
        assert!(!looks_like_js_shell(SSR_ARTICLE, 8_000));
    }

    #[test]
    fn short_extraction_with_dense_scripts_is_a_shell() {
        // No mount point; the payload is one huge inline script blob.
        let blob = "window.__INITIAL_STATE__ = ".to_string() + &"x".repeat(10_000) + ";";
        let html = format!(
            r#"<html><body><nav>Home About Contact</nav><script>{}</script></body></html>"#,
            blob
        );
        assert!(looks_like_js_shell(&html, 300));
    }

    #[test]
    fn script_heavy_page_with_real_content_is_not_a_shell() {
        // Big __NEXT_DATA__ blob but the static text is substantial.
        let blob = "window.__DATA__ = ".to_string() + &"y".repeat(20_000) + ";";
        let html = format!(
            r#"<html><body><article>{}</article><script>{}</script></body></html>"#,
            "word ".repeat(2_000),
            blob
        );
        assert!(!looks_like_js_shell(&html, 9_000));
    }

    #[test]
    fn js_gate_phrase_in_short_content_is_low_quality() {
        let md = "# Acme\n\nPlease enable JavaScript to run this app.";
        assert!(has_low_quality_text(md));
    }

    #[test]
    fn js_gate_phrase_in_long_content_is_not_low_quality() {
        // The phrase appears inside a real article's quote; length clears the gate.
        let md = format!(
            "{}\n\n> they told users: please enable javascript\n\n{}",
            "paragraph ".repeat(100),
            "more text ".repeat(100)
        );
        assert!(md.chars().count() >= JS_GATE_MAX_CHARS);
        assert!(!has_low_quality_text(&md));
    }

    #[test]
    fn navigation_density_above_threshold_is_low_quality() {
        let md = (0..20)
            .map(|i| format!("Home Link{} Tag{}", i, i))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(has_low_quality_text(&md));
    }

    #[test]
    fn article_with_mixed_line_lengths_is_not_low_quality() {
        // Long paragraphs interleaved with short headings stay under 70% short.
        let mut lines = Vec::new();
        for i in 0..12 {
            lines.push(format!("## Section {}", i));
            lines.push(format!(
                "This paragraph is deliberately long enough to exceed the forty-character threshold, {}.",
                i
            ));
        }
        let md = lines.join("\n");
        assert!(!has_low_quality_text(&md));
    }

    #[test]
    fn few_lines_is_never_navigation_density() {
        let md = "Home\nAbout\nContact\nDocs\nBlog\nPricing\nLogin";
        assert!(!has_low_quality_text(md));
    }

    #[test]
    fn plain_short_page_is_not_a_shell() {
        let html = r#"<html><body><p>A short but complete note.</p>
            <script>console.log('hi')</script></body></html>"#;
        assert!(!looks_like_js_shell(html, 40));
    }

    #[test]
    fn empty_html_is_not_a_shell() {
        assert!(!looks_like_js_shell("", 0));
    }
}
