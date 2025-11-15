/// Utility for parsing thinking content from LLM responses
/// Supports various thinking markers used by reasoning models like DeepSeek-R1

use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    // Match <think>...</think> tags (case insensitive)
    static ref THINK_TAG_REGEX: Regex = Regex::new(r"(?is)<think>(.*?)</think>").unwrap();
    // Match <thinking>...</thinking> tags (case insensitive)
    static ref THINKING_TAG_REGEX: Regex = Regex::new(r"(?is)<thinking>(.*?)</thinking>").unwrap();
    // Match <reasoning>...</reasoning> tags (case insensitive)
    static ref REASONING_TAG_REGEX: Regex = Regex::new(r"(?is)<reasoning>(.*?)</reasoning>").unwrap();
}

#[derive(Debug, Clone)]
pub struct ParsedContent {
    pub content: String,
    pub thinking_content: Option<String>,
}

/// Parse thinking content from a response string
/// Extracts content within thinking tags and removes them from the main content
pub fn parse_thinking_content(text: &str) -> ParsedContent {
    let mut thinking_parts = Vec::new();
    let mut cleaned_content = text.to_string();
    
    // Extract <think>...</think> content
    for cap in THINK_TAG_REGEX.captures_iter(text) {
        if let Some(thinking) = cap.get(1) {
            thinking_parts.push(thinking.as_str().trim().to_string());
        }
    }
    cleaned_content = THINK_TAG_REGEX.replace_all(&cleaned_content, "").to_string();
    
    // Extract <thinking>...</thinking> content
    for cap in THINKING_TAG_REGEX.captures_iter(text) {
        if let Some(thinking) = cap.get(1) {
            thinking_parts.push(thinking.as_str().trim().to_string());
        }
    }
    cleaned_content = THINKING_TAG_REGEX.replace_all(&cleaned_content, "").to_string();
    
    // Extract <reasoning>...</reasoning> content
    for cap in REASONING_TAG_REGEX.captures_iter(text) {
        if let Some(reasoning) = cap.get(1) {
            thinking_parts.push(reasoning.as_str().trim().to_string());
        }
    }
    cleaned_content = REASONING_TAG_REGEX.replace_all(&cleaned_content, "").to_string();
    
    // Clean up the main content (remove extra whitespace)
    cleaned_content = cleaned_content.trim().to_string();
    
    // Combine all thinking parts
    let thinking_content = if thinking_parts.is_empty() {
        None
    } else {
        Some(thinking_parts.join("\n\n"))
    };
    
    ParsedContent {
        content: cleaned_content,
        thinking_content,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_think_tags() {
        let text = "<think>Let me consider this carefully...</think>The answer is 42.";
        let parsed = parse_thinking_content(text);
        assert_eq!(parsed.content, "The answer is 42.");
        assert_eq!(parsed.thinking_content, Some("Let me consider this carefully...".to_string()));
    }

    #[test]
    fn test_parse_thinking_tags() {
        let text = "<thinking>First, I need to analyze...</thinking>Result: Success";
        let parsed = parse_thinking_content(text);
        assert_eq!(parsed.content, "Result: Success");
        assert_eq!(parsed.thinking_content, Some("First, I need to analyze...".to_string()));
    }

    #[test]
    fn test_parse_multiple_tags() {
        let text = "<think>Step 1</think>Answer part 1<think>Step 2</think>Answer part 2";
        let parsed = parse_thinking_content(text);
        assert_eq!(parsed.content, "Answer part 1Answer part 2");
        assert_eq!(parsed.thinking_content, Some("Step 1\n\nStep 2".to_string()));
    }

    #[test]
    fn test_no_thinking_tags() {
        let text = "Just a regular response without thinking.";
        let parsed = parse_thinking_content(text);
        assert_eq!(parsed.content, text);
        assert_eq!(parsed.thinking_content, None);
    }
}

