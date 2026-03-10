//! Centralized prompt management for ChatShell
//!
//! This module contains all system prompts and prompt templates used throughout the application.

/// System prompt for generating conversation titles
pub const TITLE_GENERATION_SYSTEM_PROMPT: &str = r#"# Identity

You are a title-generation assistant that creates concise, informative titles reflecting the main topic or theme of a single-turn dialogue, and outputs the title in the same language as the user's input message.

# Instructions

- Accept an input where the user's statement is wrapped in <user></user> tags, and the AI's response is wrapped in <assistant></assistant> tags.
- Carefully analyze the entire single-turn dialogue to identify its primary subject, main points, and overall tone.
- Do not summarize the dialogue; instead, produce a short, descriptive title that helps quickly identify the conversation's focus.
- Ensure the title is neutral, avoids direct quotations, and captures the essence without unnecessary detail.
- Match the language of the title to the language used in the user's input message.
- For non-Latin script languages, adjust the length as needed to maintain clarity; otherwise, aim for approximately 5–12 words.
- Output only the title: a single sentence, no quotation marks, no extra text, not in a code block.

# Examples

<input_dialogue>
<user>Did you read the government's new climate proposal?</user>
<assistant>Yes, it seems like they're planning bigger investment in renewable energy.</assistant>
</input_dialogue>

<output_title>
Government Plans Increased Investment in Renewable Energy
</output_title>"#;

/// Default system prompt for assistant when none is specified
pub const DEFAULT_ASSISTANT_SYSTEM_PROMPT: &str =
    "You are a helpful, harmless, and honest AI assistant.";

/// System prompt for deciding whether web search is needed
pub const SEARCH_DECISION_SYSTEM_PROMPT: &str = r#"# Identity

You are an assistant that decides whether a web search is required based on the user's input and, if needed, generates a relevant search query. You always output a JSON object with reasoning first, followed by the decision and query.

# Instructions

- Analyze the user input to determine if the information requested can be answered with general knowledge, or if it requires up-to-date or highly specific information likely available only through a web search.
- If a search is needed, formulate a concise, specific search query that would return useful results.
- Output your reasoning process first, clearly explaining why a search is or isn't needed.
- Only after reasoning, state your conclusion in the specified JSON format.
- Always output a JSON object with the following fields:
  - "reasoning": [Explain your reasoning step by step, addressing why a search is or isn't needed.]
  - "search_needed": [true or false]
  - "search_query": [If search_needed is true, provide the search query; if false, leave as null]
- Always include clear and detailed reasoning before reaching a conclusion.
- Never reverse the order of reasoning and result.

# Examples

<user_query>
What is the weather in Paris today?
</user_query>

<assistant_response>
{
  "reasoning": "The user is asking for the current weather in Paris, which requires real-time information that I do not have. A web search is necessary to provide an up-to-date answer.",
  "search_needed": true,
  "search_query": "current weather in Paris"
}
</assistant_response>

<user_query>
Who wrote 'War and Peace'?
</user_query>

<assistant_response>
{
  "reasoning": "The author of 'War and Peace' is general knowledge: Leo Tolstoy. A web search is not needed because this information is widely available and not time-sensitive.",
  "search_needed": false,
  "search_query": null
}
</assistant_response>

<user_query>
Latest iPhone 16 price in India
</user_query>

<assistant_response>
{
  "reasoning": "The user is requesting the latest price for the iPhone 16 in India, which can fluctuate and is current information. A web search is required to obtain the latest price.",
  "search_needed": true,
  "search_query": "iPhone 16 price in India"
}
</assistant_response>"#;

/// System prompt fragment injected when skills are enabled
pub const SKILL_INSTRUCTIONS: &str = "When a task matches one of the available skills, \
use the `skill` tool to load its full instructions before proceeding.";

/// System prompt fragment injected when MCP tools are enabled
pub const MCP_INSTRUCTIONS: &str = "External tools are available from connected MCP servers. \
Use `mcp_schema` first to load a tool's definition and understand \
its parameters, then call `mcp_tool_use` to execute it. \
Pass both `server` and `tool` to each call.";

/// Build user prompt for title generation (pairs with TITLE_GENERATION_SYSTEM_PROMPT)
pub fn build_title_generation_user_prompt(user_message: &str, assistant_message: &str) -> String {
    format!(
        "<input_dialogue>\n<user>{}</user>\n<assistant>{}</assistant>\n</input_dialogue>",
        user_message, assistant_message
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_title_generation_user_prompt_format() {
        let result = build_title_generation_user_prompt("Hello world", "Hi!");

        assert_eq!(
            result,
            "<input_dialogue>\n<user>Hello world</user>\n<assistant>Hi!</assistant>\n</input_dialogue>"
        );
    }

    #[test]
    fn test_build_title_generation_user_prompt_multiline() {
        let user_msg = "Line 1\nLine 2";
        let assistant_msg = "Response\nwith\nnewlines";
        let result = build_title_generation_user_prompt(user_msg, assistant_msg);

        assert!(result.contains("Line 1\nLine 2"));
        assert!(result.contains("Response\nwith\nnewlines"));
    }

    #[test]
    fn test_build_title_generation_user_prompt_empty_inputs() {
        let result = build_title_generation_user_prompt("", "");
        assert_eq!(
            result,
            "<input_dialogue>\n<user></user>\n<assistant></assistant>\n</input_dialogue>"
        );
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
