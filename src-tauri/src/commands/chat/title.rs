//! Conversation title generation

use super::super::AppState;
use super::aux_models;
use crate::llm::{self, ChatMessage};
use crate::prompts;
use anyhow::Result;
use tauri::{Emitter, State};

/// Helper to get provider info from conversation participants.
/// Returns (provider_type, model_id, api_key, base_url, api_style).
pub(crate) async fn get_conversation_provider_info(
    state: &AppState,
    conversation_id: &str,
) -> Result<
    (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ),
    String,
> {
    let participants = state
        .db
        .list_conversation_participants(conversation_id)
        .await
        .map_err(|e| e.to_string())?;

    let model_participant = participants
        .iter()
        .find(|p| p.participant_type == "model" || p.participant_type == "assistant");

    if let Some(participant) = model_participant {
        if let Some(ref participant_id) = participant.participant_id {
            if participant.participant_type == "model" {
                let model_info = state
                    .db
                    .get_model(participant_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Model not found".to_string())?;

                let provider_info = state
                    .db
                    .get_provider(&model_info.provider_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Provider not found".to_string())?;

                return Ok((
                    provider_info.provider_type,
                    model_info.model_id,
                    provider_info.api_key,
                    provider_info.base_url,
                    provider_info.api_style,
                ));
            } else {
                let assistant = state
                    .db
                    .get_assistant(participant_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Assistant not found".to_string())?;

                let model_info = state
                    .db
                    .get_model(&assistant.model_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Assistant's model not found".to_string())?;

                let provider_info = state
                    .db
                    .get_provider(&model_info.provider_id)
                    .await
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Provider not found".to_string())?;

                return Ok((
                    provider_info.provider_type,
                    model_info.model_id,
                    provider_info.api_key,
                    provider_info.base_url,
                    provider_info.api_style,
                ));
            }
        }
        return Err("Participant has no ID".to_string());
    }
    Err("No model or assistant found in conversation".to_string())
}

#[tauri::command]
pub async fn generate_conversation_title_manually(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<String, String> {
    tracing::info!(
        "🏷️ [manual_title] Generating title for conversation: {}",
        conversation_id
    );

    // Get conversation messages
    let messages = state
        .db
        .list_messages_by_conversation(&conversation_id, None, None)
        .await
        .map_err(|e| e.to_string())?;

    if messages.is_empty() {
        return Err("No messages in conversation to generate title from".to_string());
    }

    // Find first user message
    let user_message = messages
        .iter()
        .find(|m| m.sender_type == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    if user_message.is_empty() {
        return Err("No user message found to generate title from".to_string());
    }

    // Get provider info from conversation participants
    let (provider, model, api_key, base_url, api_style) =
        get_conversation_provider_info(&state, &conversation_id).await?;

    // Generate the title
    let title = generate_conversation_title(
        &state,
        &user_message,
        &provider,
        &model,
        api_key,
        base_url,
        api_style,
    )
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!("🏷️ [manual_title] Generated title: {}", title);
    Ok(title)
}

/// Helper function to generate conversation title
pub(crate) async fn generate_conversation_title(
    state: &AppState,
    user_message: &str,
    provider: &str,
    model: &str,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
) -> Result<String> {
    tracing::info!("🏷️ [generate_title] Starting title generation...");

    // Route to the lightweight aux model when configured: title generation
    // is a cheap call, not main-model work.
    let conversation = aux_models::ConversationModel {
        provider_type: provider.to_string(),
        model_id: model.to_string(),
        api_key: api_key.clone(),
        base_url: base_url.clone(),
        api_style: api_style.clone(),
        supports_vision: None,
    };
    let aux = aux_models::resolve_aux_tiny(state, &conversation).await;

    // Generate title using unified provider handler
    let response = llm::call_provider(
        &aux.provider_type,
        aux.model_id,
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: prompts::TITLE_GENERATION_SYSTEM_PROMPT.to_string(),
                images: vec![],
                files: vec![],
                tool_calls: vec![],
                tool_call_id: None,
                tool_result_call_id: None,
                reasoning_content: None,
            },
            ChatMessage {
                role: "user".to_string(),
                content: prompts::build_title_generation_user_prompt(user_message),
                images: vec![],
                files: vec![],
                tool_calls: vec![],
                tool_call_id: None,
                tool_result_call_id: None,
                reasoning_content: None,
            },
        ],
        aux.api_key,
        aux.base_url,
        aux.api_style,
    )
    .await?;

    // Normalize and reject unusable output so auto-titling retries on the
    // next message instead of latching onto model noise.
    let Some(title) = normalize_generated_title(&response.content) else {
        anyhow::bail!("Generated title was unusable: {:?}", response.content);
    };

    tracing::info!("🏷️ [generate_title] Generated title: {}", title);
    Ok(title)
}

/// Helper function to auto-generate title for new conversations
pub(crate) async fn auto_generate_title_if_needed(
    state: &AppState,
    app: &tauri::AppHandle,
    conversation_id: &str,
    user_content: &str,
    provider: &str,
    model: &str,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
) {
    if let Ok(Some(conversation)) = state.db.get_conversation(conversation_id).await
        && conversation.title.is_empty()
    {
        if is_low_signal_title_input(user_content) {
            tracing::info!("🏷️ [auto_title] Low-signal first message, deferring title generation");
            return;
        }

        tracing::info!("🏷️ [auto_title] Generating title for new conversation...");
        match generate_conversation_title(
            state,
            user_content,
            provider,
            model,
            api_key,
            base_url,
            api_style,
        )
        .await
        {
            Ok(title) => {
                match state.db.update_conversation(conversation_id, &title).await {
                    Ok(_) => {
                        tracing::info!("✅ [auto_title] Conversation title updated to: {}", title);
                        // Notify frontend of title update
                        let _ = app.emit(
                            "conversation-updated",
                            serde_json::json!({
                                "conversation_id": conversation_id,
                                "title": title,
                            }),
                        );
                    }
                    Err(e) => tracing::error!(
                        "⚠️  [auto_title] Failed to update conversation title: {}",
                        e
                    ),
                }
            }
            Err(e) => tracing::warn!("⚠️  [auto_title] Failed to generate title: {}", e),
        }
    }
}

/// Greeting / acknowledgement / filler tokens. A first user message made
/// entirely of these (or bare numbers) carries no concrete task, so titling
/// defers to a later message instead of latching onto "hi".
const LOW_SIGNAL_TITLE_TOKENS: &[&str] = &[
    // greetings
    "hi",
    "hii",
    "hiii",
    "hey",
    "heya",
    "hello",
    "yo",
    "sup",
    "howdy",
    "greetings",
    "hola",
    "ciao",
    "gm",
    "gn",
    // politeness / acknowledgement
    "thanks",
    "thank",
    "thx",
    "ty",
    "cheers",
    "please",
    "ok",
    "okay",
    "k",
    "yep",
    "yes",
    "yeah",
    "nope",
    "no",
    "nah",
    "sure",
    "cool",
    "nice",
    "great",
    "lol",
    "haha",
    // poking the agent / fillers
    "test",
    "testing",
    "ping",
    "pong",
    "there",
    "you",
    "hmm",
    "um",
    "so",
    "well",
    "anyway",
    // CJK greetings / fillers. All three major CJK languages are covered so
    // the low-signal detector works for the app's full locale set; these
    // are functional string data, not UI copy.
    // Simplified Chinese
    "你好",
    "您好",
    "嗨",
    "哈喽",
    "在吗",
    "在么",
    "谢谢",
    "好的",
    "嗯",
    // Japanese
    "こんにちは",
    "こんばんは",
    "おはよう",
    "ありがとう",
    "ありがとうございます",
    "はい",
    "うん",
    // Korean
    "안녕",
    "안녕하세요",
    "감사",
    "감사합니다",
    "네",
    "응",
];

/// True when a first user message is too low-signal to title: greetings,
/// acknowledgements, bare numbers, or nothing once punctuation is stripped.
fn is_low_signal_title_input(message: &str) -> bool {
    let lowered = message.to_lowercase();
    let words: Vec<&str> = lowered
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    if words.is_empty() {
        return true;
    }
    words.iter().all(|word| {
        LOW_SIGNAL_TITLE_TOKENS.contains(word) || word.chars().all(|c| c.is_ascii_digit())
    })
}

/// Maximum accepted title length in characters.
const MAX_TITLE_CHARS: usize = 80;
/// Maximum accepted title word count.
const MAX_TITLE_WORDS: usize = 12;

/// Normalize a generated title: first line only, strip quotes/tags/trailing
/// punctuation, and reject empty, punctuation-only, oversized, or wordy
/// output (returns `None` so the caller defers titling instead of saving
/// model noise).
fn normalize_generated_title(value: &str) -> Option<String> {
    let first_line = value.trim().lines().next()?.trim();
    let title = first_line
        .trim_start_matches(['"', '\''])
        .trim_end_matches(['"', '\''])
        .trim_start_matches("<title>")
        .trim_end_matches("</title>")
        .trim_start_matches(['"', '\''])
        .trim_end_matches(['"', '\''])
        .trim_end_matches(['.', '!', '?'])
        .trim();
    if title.is_empty() || !title.chars().any(char::is_alphanumeric) {
        return None;
    }
    let words = title.split_whitespace().count();
    if title.chars().count() > MAX_TITLE_CHARS || words > MAX_TITLE_WORDS {
        return None;
    }
    Some(title.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_signal_inputs_are_detected() {
        assert!(is_low_signal_title_input("hi"));
        assert!(is_low_signal_title_input("Hello!"));
        assert!(is_low_signal_title_input("ok ok"));
        assert!(is_low_signal_title_input("42"));
        assert!(is_low_signal_title_input("你好"));
        assert!(is_low_signal_title_input(""));
        assert!(!is_low_signal_title_input("Fix the login bug"));
        assert!(!is_low_signal_title_input("帮我把标题改成蓝色"));
        assert!(!is_low_signal_title_input("test the parser"));
        assert!(is_low_signal_title_input("こんにちは"));
        assert!(is_low_signal_title_input("안녕하세요"));
        assert!(!is_low_signal_title_input("ログインバグを直して"));
        assert!(!is_low_signal_title_input("로그인 버그를 수정해줘"));
    }

    #[test]
    fn title_normalization_strips_and_rejects() {
        assert_eq!(
            normalize_generated_title("  \"Fix login bug\"  ").as_deref(),
            Some("Fix login bug")
        );
        assert_eq!(
            normalize_generated_title("Fix login bug.").as_deref(),
            Some("Fix login bug")
        );
        assert_eq!(
            normalize_generated_title("<title>Fix login bug</title>").as_deref(),
            Some("Fix login bug")
        );
        assert_eq!(
            normalize_generated_title("Fix.\nEverything after the first line is ignored."),
            Some("Fix".to_string())
        );
        assert_eq!(normalize_generated_title(""), None);
        assert_eq!(normalize_generated_title(".."), None);
        assert_eq!(normalize_generated_title(&"x".repeat(81)), None);
        assert_eq!(
            normalize_generated_title(
                "one two three four five six seven eight nine ten eleven twelve thirteen"
            ),
            None
        );
    }
}
