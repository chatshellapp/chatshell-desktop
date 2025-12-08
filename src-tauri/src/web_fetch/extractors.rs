use scraper::{Html, Selector};
use std::collections::HashSet;
use url::Url;

use super::types::{IMG_ALT_REGEX, IMG_SRC_REGEX, IMG_TAG_REGEX, URL_REGEX};

/// Extract and validate URLs from text, with deduplication
pub fn extract_urls(text: &str) -> Vec<String> {
    URL_REGEX
        .find_iter(text)
        .filter_map(|m| {
            let url_str = m.as_str();
            // Validate URL using the url crate
            Url::parse(url_str).ok().map(|u| u.to_string())
        })
        .collect::<HashSet<_>>() // Deduplicate
        .into_iter()
        .collect()
}

/// Extract favicon URL from HTML document
fn extract_favicon_from_html(document: &Html, base_url: &Url) -> Option<String> {
    // Try multiple selectors for favicon
    let selectors = [
        r#"link[rel="icon"]"#,
        r#"link[rel="shortcut icon"]"#,
        r#"link[rel="apple-touch-icon"]"#,
        r#"link[rel="apple-touch-icon-precomposed"]"#,
    ];

    for selector_str in &selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            for element in document.select(&selector) {
                if let Some(href) = element.value().attr("href") {
                    // Resolve relative URL to absolute
                    if let Ok(favicon_url) = base_url.join(href) {
                        return Some(favicon_url.to_string());
                    }
                }
            }
        }
    }

    None
}

/// Extract favicon URL from HTML content only
/// Returns None if favicon cannot be extracted from HTML (frontend will show globe icon)
pub fn extract_favicon_url(url: &str, html_content: Option<&str>) -> Option<String> {
    let parsed_url = Url::parse(url).ok()?;

    // Only extract favicon from HTML content
    if let Some(html) = html_content {
        let document = Html::parse_document(html);
        if let Some(favicon) = extract_favicon_from_html(&document, &parsed_url) {
            tracing::info!("✅ [favicon] Found icon in HTML for {}: {}", url, favicon);
            return Some(favicon);
        }
    }

    // No favicon found - frontend will display globe icon
    None
}

pub fn extract_meta_description(document: &Html) -> Option<String> {
    // Try standard description meta tag
    let desc = Selector::parse(r#"meta[name="description"]"#)
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if desc.is_some() {
        return desc;
    }

    // Fallback to Open Graph description
    Selector::parse(r#"meta[property="og:description"]"#)
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn extract_meta_keywords(document: &Html) -> Option<String> {
    Selector::parse(r#"meta[name="keywords"]"#)
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn extract_headings(document: &Html) -> Vec<String> {
    Selector::parse("h1, h2, h3")
        .ok()
        .map(|sel| {
            document
                .select(&sel)
                .take(10)
                .map(|el| el.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Truncate string by character count (not bytes), returns (truncated_string, was_truncated)
pub fn truncate_by_chars(s: &str, max_chars: usize) -> (String, bool) {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        (s.to_string(), false)
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        (
            format!(
                "{}\n\n[Content truncated - original length: {} characters]",
                truncated, char_count
            ),
            true,
        )
    }
}

/// Normalize HTML img tags to simple format for better htmd conversion
/// Handles complex img tags with srcset, sizes, and other attributes
/// Converts them to simple <img src="..." alt="..."> format
pub fn normalize_html_images(html: &str) -> String {
    IMG_TAG_REGEX
        .replace_all(html, |caps: &regex::Captures| {
            let img_tag = &caps[0];

            // Extract src attribute
            let src = IMG_SRC_REGEX
                .captures(img_tag)
                .map(|c| c[1].to_string())
                .unwrap_or_default();

            // Skip if no src found
            if src.is_empty() {
                return img_tag.to_string();
            }

            // Extract alt attribute (default to empty string)
            let alt = IMG_ALT_REGEX
                .captures(img_tag)
                .map(|c| c[1].to_string())
                .unwrap_or_default();

            format!(r#"<img src="{}" alt="{}">"#, src, alt)
        })
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_urls() {
        let text = "Check out https://example.com and http://test.org/path?query=1";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 2);
        assert!(urls.contains(&"https://example.com/".to_string()));
        assert!(urls.contains(&"http://test.org/path?query=1".to_string()));
    }

    #[test]
    fn test_extract_urls_deduplication() {
        let text = "Visit https://example.com and then https://example.com again";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 1);
    }

    #[test]
    fn test_extract_urls_invalid() {
        let text = "This is not a valid URL: http://";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 0);
    }

    #[test]
    fn test_no_urls() {
        let text = "This is a message without any URLs";
        let urls = extract_urls(text);
        assert_eq!(urls.len(), 0);
    }

    #[test]
    fn test_truncate_by_chars() {
        let text = "Hello, World!";
        let (truncated, was_truncated) = truncate_by_chars(text, 5);
        assert!(was_truncated);
        assert!(truncated.starts_with("Hello"));
        assert!(truncated.contains("[Content truncated"));
    }

    #[test]
    fn test_truncate_by_chars_no_truncation() {
        let text = "Hello";
        let (result, was_truncated) = truncate_by_chars(text, 10);
        assert!(!was_truncated);
        assert_eq!(result, "Hello");
    }

    #[test]
    fn test_normalize_html_images_with_srcset() {
        let html = r#"<img src="https://example.com/image.jpg!720" alt="" width="1920" height="1080" srcset="https://example.com/image.jpg!720 1920w, https://example.com/image-360.jpg 360w" sizes="(max-width: 1920px) 100vw, 1920px">"#;
        let result = normalize_html_images(html);
        assert_eq!(
            result,
            r#"<img src="https://example.com/image.jpg!720" alt="">"#
        );
    }

    #[test]
    fn test_normalize_html_images_with_alt() {
        let html = r#"<img src="https://example.com/photo.png" alt="A beautiful sunset" class="responsive">"#;
        let result = normalize_html_images(html);
        assert_eq!(
            result,
            r#"<img src="https://example.com/photo.png" alt="A beautiful sunset">"#
        );
    }

    #[test]
    fn test_normalize_html_images_alt_before_src() {
        let html = r#"<img alt="Test image" src="https://example.com/test.jpg" width="100">"#;
        let result = normalize_html_images(html);
        assert_eq!(
            result,
            r#"<img src="https://example.com/test.jpg" alt="Test image">"#
        );
    }

    #[test]
    fn test_normalize_html_images_self_closing() {
        let html = r#"<img src="https://example.com/image.jpg" alt="test" />"#;
        let result = normalize_html_images(html);
        assert_eq!(
            result,
            r#"<img src="https://example.com/image.jpg" alt="test">"#
        );
    }

    #[test]
    fn test_normalize_html_images_multiple() {
        let html = r#"<p><img src="https://a.com/1.jpg" alt="first" srcset="..."></p><p><img src="https://b.com/2.jpg" alt="second"></p>"#;
        let result = normalize_html_images(html);
        assert!(result.contains(r#"<img src="https://a.com/1.jpg" alt="first">"#));
        assert!(result.contains(r#"<img src="https://b.com/2.jpg" alt="second">"#));
    }
}
