//! AI-powered search decision logic
//!
//! Uses LLM to determine if web search is needed for a given user query.

use anyhow::Result;
use serde_json::Value;

use crate::llm::{self, ChatMessage};
use crate::prompts::SEARCH_DECISION_SYSTEM_PROMPT;

use super::types::SearchDecisionResult;

/// Use AI to decide if web search is needed for the given user input
/// Uses the same provider/model as the current conversation
pub async fn decide_search_needed(
    user_input: &str,
    provider: &str,
    model: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> Result<SearchDecisionResult> {
    tracing::info!(
        "🤔 [search_decision] Asking AI if search is needed for: {}",
        user_input.chars().take(100).collect::<String>()
    );

    // Use the unified LLM provider function
    let response = llm::call_provider(
        provider,
        model.to_string(),
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: SEARCH_DECISION_SYSTEM_PROMPT.to_string(),
                images: vec![],
                files: vec![],
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_input.to_string(),
                images: vec![],
                files: vec![],
            },
        ],
        api_key.map(|s| s.to_string()),
        base_url.map(|s| s.to_string()),
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
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            return Ok(trimmed[start..=end].to_string());
        }
    }

    Err(anyhow::anyhow!("No JSON found in response"))
}
