//! AI-powered search decision logic
//!
//! Uses LLM to determine if web search is needed for a given user query.

use anyhow::Result;
use chrono::Local;
use serde_json::Value;

use crate::llm::{self, ChatMessage};
use crate::prompts::SEARCH_DECISION_SYSTEM_PROMPT;

use super::types::SearchDecisionResult;

/// Use AI to decide if web search is needed for the given user input.
/// Callers pass the auxiliary tiny model and fall back to the conversation
/// model when no aux model is configured.
pub async fn decide_search_needed(
    user_input: &str,
    provider: &str,
    model: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    api_style: Option<&str>,
) -> Result<SearchDecisionResult> {
    tracing::info!(
        "🤔 [search_decision] Asking AI if search is needed for: {}",
        user_input.chars().take(100).collect::<String>()
    );

    let now = Local::now();
    let current_datetime = now.format("%A, %B %-d, %Y %H:%M %Z").to_string();
    let system_prompt = format!(
        "{}\n\nCurrent date and time: {}",
        SEARCH_DECISION_SYSTEM_PROMPT, current_datetime
    );

    let response = llm::call_provider(
        provider,
        model.to_string(),
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt,
                images: vec![],
                files: vec![],
                tool_calls: vec![],
                tool_call_id: None,
                tool_result_call_id: None,
                reasoning_content: None,
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_input.to_string(),
                images: vec![],
                files: vec![],
                tool_calls: vec![],
                tool_call_id: None,
                tool_result_call_id: None,
                reasoning_content: None,
            },
        ],
        api_key.map(|s| s.to_string()),
        base_url.map(|s| s.to_string()),
        api_style.map(|s| s.to_string()),
    )
    .await?;

    tracing::info!("📝 [search_decision] AI response: {}", response.content);

    // Parse JSON from response
    let json_str = extract_json_from_response(&response.content)?;
    let parsed: Value = serde_json::from_str(&json_str)
        .map_err(|e| anyhow::anyhow!("Failed to parse JSON: {}", e))?;

    let result = SearchDecisionResult {
        reasoning: parsed["reasoning"].as_str().unwrap_or("").to_string(),
        search_needed: parsed["search_needed"].as_bool().unwrap_or(false),
        search_query: parsed["search_query"].as_str().map(|s| s.to_string()),
    };

    tracing::info!(
        "✅ [search_decision] Decision: search_needed={}, query={:?}",
        result.search_needed,
        result.search_query
    );

    Ok(result)
}

/// Extract JSON from AI response (handles markdown code blocks)
fn extract_json_from_response(response: &str) -> Result<String> {
    let trimmed = response.trim();

    // Try to find JSON in code block
    if let Some(start) = trimmed.find("```json") {
        let json_start = start + 7;
        if let Some(end) = trimmed[json_start..].find("```") {
            return Ok(trimmed[json_start..json_start + end].trim().to_string());
        }
    }

    // Try to find JSON in generic code block
    if let Some(start) = trimmed.find("```") {
        let block_start = start + 3;
        let content_start = trimmed[block_start..]
            .find('\n')
            .map(|i| block_start + i + 1)
            .unwrap_or(block_start);
        if let Some(end) = trimmed[content_start..].find("```") {
            return Ok(trimmed[content_start..content_start + end]
                .trim()
                .to_string());
        }
    }

    // Try to find raw JSON object
    if let Some(start) = trimmed.find('{')
        && let Some(end) = trimmed.rfind('}')
        && end >= start
    {
        return Ok(trimmed[start..=end].to_string());
    }

    Err(anyhow::anyhow!("No JSON found in response"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- extract_json_from_response: ```json fences ----

    #[test]
    fn json_fenced_object_is_extracted() {
        let response =
            "```json\n{\"search_needed\": true, \"search_query\": \"rust release date\"}\n```";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"search_needed\": true, \"search_query\": \"rust release date\"}"
        );
    }

    #[test]
    fn json_fenced_object_with_padded_content_is_trimmed() {
        let response = "```json\n   {\"search_needed\": false}   \n```";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"search_needed\": false}"
        );
    }

    #[test]
    fn json_fence_wins_over_earlier_plain_fence() {
        let response = "```\nignore this block\n```\n```json\n{\"chosen\": 1}\n```";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"chosen\": 1}"
        );
    }

    #[test]
    fn unterminated_json_fence_falls_back_to_raw_brace_span() {
        let response = "```json\n{\"search_needed\": false}";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"search_needed\": false}"
        );
    }

    // ---- extract_json_from_response: generic fences ----

    #[test]
    fn generic_fence_skips_language_line() {
        let response = "```python\n{\"search_needed\": true}\n```";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"search_needed\": true}"
        );
    }

    #[test]
    fn single_line_generic_fence_is_extracted() {
        let response = "```{\"search_needed\": true}```";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"search_needed\": true}"
        );
    }

    #[test]
    fn fenced_non_json_content_is_returned_verbatim() {
        // Extraction is purely mechanical; JSON validation happens downstream.
        let response = "```\nno braces here\n```";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "no braces here"
        );
    }

    // ---- extract_json_from_response: raw brace span fallback ----

    #[test]
    fn raw_object_surrounded_by_prose_is_extracted() {
        let response = "Decision: {\"search_needed\": true, \"search_query\": \"weather\"} thanks.";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"search_needed\": true, \"search_query\": \"weather\"}"
        );
    }

    #[test]
    fn raw_span_stretches_from_first_open_to_last_close_brace() {
        let response = "first {\"a\": 1} then {\"b\": 2} end";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"a\": 1} then {\"b\": 2}"
        );
    }

    #[test]
    fn nested_braces_stay_inside_one_span() {
        let response = "{\"outer\": {\"inner\": 1}}";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"outer\": {\"inner\": 1}}"
        );
    }

    #[test]
    fn multibyte_characters_inside_span_do_not_break_extraction() {
        let response = "Answer: {\"search_query\": \"café opening hours\"} voilà";
        assert_eq!(
            extract_json_from_response(response).unwrap(),
            "{\"search_query\": \"café opening hours\"}"
        );
    }

    // ---- extract_json_from_response: rejections ----

    #[test]
    fn inputs_without_json_are_rejected() {
        for input in [
            "",
            "   \n\t ",
            "just a plain answer",
            "{ no closing brace",
            "}",
            "```",
            "```\nno closing fence",
        ] {
            let result = extract_json_from_response(input);
            assert!(result.is_err(), "expected error for input {input:?}");
        }
    }

    #[test]
    fn error_message_names_the_problem() {
        let err = extract_json_from_response("no json at all").unwrap_err();
        assert_eq!(err.to_string(), "No JSON found in response");
    }

    #[test]
    fn close_brace_before_open_brace_is_rejected_not_panicking() {
        // Regression: a stray '}' before the first '{' previously made the
        // raw-span branch slice with start > end and panic.
        let result = extract_json_from_response("stray } before { any brace");
        assert!(result.is_err());
    }

    // ---- decide_search_needed: offline error propagation ----

    #[tokio::test]
    async fn decide_search_needed_fails_fast_for_unknown_provider() {
        let err = decide_search_needed(
            "who won the last world series",
            "definitely-not-a-provider",
            "some-model",
            Some("key"),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("Unknown provider"));
    }

    #[tokio::test]
    async fn decide_search_needed_requires_api_key_for_keyed_providers() {
        let err =
            decide_search_needed("what time is it", "openai", "gpt-4o-mini", None, None, None)
                .await
                .unwrap_err();
        assert!(err.to_string().contains("API key required"));
    }
}
