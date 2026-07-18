pub use chatshell_agent_core::parse_thinking_content;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_think_tags() {
        let text = "<think>Let me consider this carefully...</think>The answer is 42.";
        let parsed = parse_thinking_content(text);
        assert_eq!(parsed.content, "The answer is 42.");
        assert_eq!(
            parsed.thinking_content,
            Some("Let me consider this carefully...".to_string())
        );
    }

    #[test]
    fn test_parse_thinking_tags() {
        let text = "<thinking>First, I need to analyze...</thinking>Result: Success";
        let parsed = parse_thinking_content(text);
        assert_eq!(parsed.content, "Result: Success");
        assert_eq!(
            parsed.thinking_content,
            Some("First, I need to analyze...".to_string())
        );
    }

    #[test]
    fn test_parse_multiple_tags() {
        let text = "<think>Step 1</think>Answer part 1<think>Step 2</think>Answer part 2";
        let parsed = parse_thinking_content(text);
        assert_eq!(parsed.content, "Answer part 1Answer part 2");
        assert_eq!(
            parsed.thinking_content,
            Some("Step 1\n\nStep 2".to_string())
        );
    }

    #[test]
    fn test_no_thinking_tags() {
        let text = "Just a regular response without thinking.";
        let parsed = parse_thinking_content(text);
        assert_eq!(parsed.content, text);
        assert_eq!(parsed.thinking_content, None);
    }
}
