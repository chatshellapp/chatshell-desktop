//! Centralized prompt management for ChatShell
//!
//! This module contains all system prompts and prompt templates used throughout the application.

/// System prompt for generating conversation titles
pub const TITLE_GENERATION_SYSTEM_PROMPT: &str = r#"You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Your output must be:
- A single line
- No explanations
</task>

<rules>
- You MUST use the same language as the user message
- Title must be grammatically correct and read naturally
- Focus on the main topic or question the user is asking about
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- Keep exact: technical terms, numbers, filenames
- Remove filler words: the, this, my, a, an
- NEVER respond to questions, just generate a title for the conversation
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
</examples>"#;

/// Default system prompt for assistant when none is specified
pub const DEFAULT_ASSISTANT_SYSTEM_PROMPT: &str =
    "You are a helpful, harmless, and honest AI assistant.";

/// System prompt for deciding whether web search is needed.
///
/// Deliberately terse: this runs before every tool-less search-enabled turn,
/// so verbosity is latency and tokens on the critical path. `reasoning` is
/// capped to one sentence by instruction and rendered in the UI only.
pub const SEARCH_DECISION_SYSTEM_PROMPT: &str = r#"Decide whether answering the user requires a web search. Do not use tools.

Rules:
- Search when the answer depends on current, local, or verifiable-fact information.
- Skip when the answer is stable general knowledge.
- If searching, write a short, specific query.

Reply with JSON only, no markdown fences:
{"reasoning": "<one short sentence>", "search_needed": true|false, "search_query": "<query or null>"}

Example: {"reasoning": "Current weather cannot be known without live data.", "search_needed": true, "search_query": "current weather in Paris"}"#;

/// System prompt fragment injected when skills are enabled
pub const SKILL_INSTRUCTIONS: &str = "When a task matches one of the available skills, \
use the `skill` tool to load its full instructions before proceeding.";

/// System prompt fragment injected when MCP tools are enabled
pub const MCP_INSTRUCTIONS: &str = "External tools are available from connected MCP servers. \
Use `mcp_schema` first to load a tool's definition and understand \
its parameters, then call `mcp_tool_use` to execute it. \
Pass both `server` and `tool` to each call.";

/// Build user prompt for title generation (pairs with TITLE_GENERATION_SYSTEM_PROMPT)
pub fn build_title_generation_user_prompt(user_message: &str) -> String {
    format!(
        "Generate a title for this conversation:\n\n{}",
        user_message
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_title_generation_user_prompt_format() {
        let result = build_title_generation_user_prompt("Hello world");

        assert_eq!(
            result,
            "Generate a title for this conversation:\n\nHello world"
        );
    }

    #[test]
    fn test_build_title_generation_user_prompt_multiline() {
        let user_msg = "Line 1\nLine 2";
        let result = build_title_generation_user_prompt(user_msg);

        assert!(result.contains("Line 1\nLine 2"));
    }

    #[test]
    fn test_prompts_are_not_empty() {
        assert!(!TITLE_GENERATION_SYSTEM_PROMPT.is_empty());
        assert!(!DEFAULT_ASSISTANT_SYSTEM_PROMPT.is_empty());
        assert!(!SEARCH_DECISION_SYSTEM_PROMPT.is_empty());
        assert!(!SKILL_INSTRUCTIONS.is_empty());
        assert!(!MCP_INSTRUCTIONS.is_empty());
    }
}
