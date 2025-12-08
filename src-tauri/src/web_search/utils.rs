//! Utility functions for web search

/// Extract search keywords from user input
///
/// This is a simple implementation that extracts the first few lines
/// and truncates to a reasonable length for search queries.
///
/// # Arguments
/// * `user_input` - The raw user input text
///
/// # Returns
/// A cleaned up string suitable for search queries
pub fn extract_search_keywords(user_input: &str) -> String {
    // Simple implementation: clean up the input
    // Take first 3 lines and join them
    let cleaned = user_input.lines().take(3).collect::<Vec<_>>().join(" ");

    // Remove extra whitespace
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");

    // Truncate to reasonable length for search
    if cleaned.len() > 150 {
        cleaned.chars().take(150).collect()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_search_keywords_short() {
        let input = "What is Rust?";
        let result = extract_search_keywords(input);
        assert_eq!(result, "What is Rust?");
    }

    #[test]
    fn test_extract_search_keywords_multiline() {
        let input = "Line one\nLine two\nLine three\nLine four";
        let result = extract_search_keywords(input);
        assert_eq!(result, "Line one Line two Line three");
    }

    #[test]
    fn test_extract_search_keywords_truncation() {
        let input = "a ".repeat(100);
        let result = extract_search_keywords(&input);
        assert!(result.len() <= 150);
    }
}
