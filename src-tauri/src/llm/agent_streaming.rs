//! Agent streaming module for handling streaming chat responses.
//!
//! This module provides the streaming implementation for all agent types,
//! handling cancellation, error recovery, and thinking content parsing.

use anyhow::Result;
use futures::StreamExt;
use rig::agent::{Agent, MultiTurnStreamItem};
use rig::completion::Message;
use rig::message::{AssistantContent, DocumentSourceKind, Image, Reasoning};
use rig::prelude::StreamingChat;
use rig::streaming::{StreamedAssistantContent, StreamedUserContent};
use tokio_util::sync::CancellationToken;

use crate::llm::ChatResponse;
use crate::llm::common::{StreamChunkType, ToolCallInfo, ToolResultInfo};
use crate::thinking_parser;

/// Strip internal error prefixes (e.g. "CompletionError: ProviderError: ") to
/// produce a cleaner user-facing message.
fn strip_internal_prefixes(error: &str) -> String {
    let mut s = error;
    for prefix in &[
        "CompletionError: ",
        "ProviderError: ",
        "Error sending request: ",
        "HTTP error: ",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest;
        }
    }
    s.to_string()
}

/// Extract inline assistant images as data URLs. rig 0.42 delivers generated
/// images inside the final aggregated response content rather than as a
/// dedicated stream variant.
fn image_data_urls(content: &[AssistantContent]) -> Vec<String> {
    content
        .iter()
        .filter_map(|item| match item {
            AssistantContent::Image(Image {
                data: DocumentSourceKind::Base64(b64),
                media_type,
                ..
            }) => {
                let mime = media_type
                    .as_ref()
                    .map(|mt| rig::message::MimeType::to_mime_type(mt).to_string())
                    .unwrap_or_else(|| "image/png".to_string());
                Some(format!("data:{mime};base64,{b64}"))
            }
            AssistantContent::Image(Image {
                data: DocumentSourceKind::Url(url),
                ..
            }) => Some(url.clone()),
            _ => None,
        })
        .collect()
}

/// Implementation for streaming with any agent type
pub async fn stream_agent(
    agent: Agent,
    prompt: Message,
    chat_history: Vec<Message>,
    cancel_token: CancellationToken,
    mut callback: impl FnMut(String, StreamChunkType) -> bool + Send,
    log_prefix: &str,
) -> Result<ChatResponse> {
    tracing::info!("🤖 [{}] Agent created, starting stream chat", log_prefix);

    let mut stream = agent
        .stream_chat(prompt, chat_history)
        .max_turns(1000)
        .await;

    let mut full_content = String::new();
    // Aggregated reasoning, kept per correlator id so a complete block can
    // supersede the deltas already forwarded for the same block (rig's
    // streaming contract) without duplicating the text.
    let mut reasoning_parts: Vec<(String, String)> = Vec::new();
    let mut cancelled = false;
    let mut consecutive_errors = 0;
    let mut is_reasoning = false;
    let mut last_error: Option<String> = None;
    const MAX_CONSECUTIVE_ERRORS: u32 = 3;

    tracing::info!("📥 [{}] Processing stream...", log_prefix);

    // Process stream with cancellation support.
    // Use tokio::select! so cancellation takes effect immediately,
    // even while a tool call is executing inside stream.next().
    loop {
        let result = tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                tracing::info!("🛑 [{}] Cancellation detected, stopping stream", log_prefix);
                cancelled = true;
                drop(stream);
                break;
            }
            item = stream.next() => {
                match item {
                    Some(r) => r,
                    None => break,
                }
            }
        };

        match result {
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(text))) => {
                consecutive_errors = 0;
                // Detect transition from reasoning to text
                if is_reasoning {
                    is_reasoning = false;
                    tracing::info!("💡 [{}] Reasoning ended", log_prefix);
                }
                let text_str = &text.text;
                if !text_str.is_empty() {
                    full_content.push_str(text_str);

                    if !callback(text_str.to_string(), StreamChunkType::Text) {
                        tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Reasoning {
                reasoning: Reasoning { content, .. },
                id,
            })) => {
                consecutive_errors = 0;
                if !is_reasoning {
                    is_reasoning = true;
                    tracing::info!("💡 [{}] Reasoning started", log_prefix);
                }
                let reasoning_text: String = content
                    .iter()
                    .filter_map(|rc| match rc {
                        rig::message::ReasoningContent::Text { text, .. } => Some(text.as_str()),
                        rig::message::ReasoningContent::Summary(s) => Some(s.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("");
                if reasoning_text.is_empty() {
                    continue;
                }
                // A complete block supersedes the deltas already forwarded for
                // the same correlator id: replace the aggregated text instead
                // of appending it, and do not re-emit it to the callback —
                // every delta of the block was already delivered.
                if let Some(part) = reasoning_parts
                    .iter_mut()
                    .find(|(part_id, _)| part_id == &id)
                {
                    part.1 = reasoning_text;
                } else {
                    reasoning_parts.push((id.clone(), reasoning_text.clone()));

                    if !callback(reasoning_text, StreamChunkType::Reasoning) {
                        tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::ToolCall {
                tool_call,
                ..
            })) => {
                consecutive_errors = 0;
                let tool_input = serde_json::to_string(&tool_call.function.arguments)
                    .unwrap_or_else(|_| "{}".to_string());

                tracing::info!(
                    "🔧 [{}] Tool call: {} (id: {})",
                    log_prefix,
                    tool_call.function.name,
                    tool_call.id
                );

                let call_id = tool_call
                    .provider
                    .as_ref()
                    .map(|provider| provider.call_id.to_string());
                let tool_info = ToolCallInfo {
                    id: tool_call.id.to_string(),
                    call_id,
                    tool_name: tool_call.function.name.clone(),
                    tool_input,
                };

                if !callback(String::new(), StreamChunkType::ToolCall(tool_info)) {
                    tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                    cancelled = true;
                    break;
                }
            }
            Ok(MultiTurnStreamItem::StreamUserItem(StreamedUserContent::ToolResult {
                tool_result,
                ..
            })) => {
                consecutive_errors = 0;
                let tool_output = tool_result
                    .content
                    .iter()
                    .filter_map(|c| match c {
                        rig::message::ToolResultContent::Text(text) => Some(text.text.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

                tracing::info!(
                    "📦 [{}] Tool result received (id: {}, {} chars)",
                    log_prefix,
                    tool_result.call,
                    tool_output.len()
                );

                let result_info = ToolResultInfo {
                    id: tool_result.call.to_string(),
                    tool_output,
                };

                if !callback(String::new(), StreamChunkType::ToolResult(result_info)) {
                    tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                    cancelled = true;
                    break;
                }
            }
            Ok(MultiTurnStreamItem::FinalResponse(final_response)) => {
                consecutive_errors = 0;
                // Log final response usage if available
                let usage = final_response.usage();
                if usage.input_tokens > 0 || usage.output_tokens > 0 {
                    tracing::info!(
                        "📊 [{}] Usage: {} input, {} output tokens",
                        log_prefix,
                        usage.input_tokens,
                        usage.output_tokens
                    );
                }
                // Generated images arrive inside the final aggregated content.
                for data_url in image_data_urls(final_response.content()) {
                    tracing::info!(
                        "🖼️ [{}] Image received ({} bytes)",
                        log_prefix,
                        data_url.len()
                    );
                    if !callback(data_url.clone(), StreamChunkType::Image(data_url)) {
                        tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(
                StreamedAssistantContent::ReasoningDelta { id, reasoning, .. },
            )) => {
                consecutive_errors = 0;
                if !is_reasoning {
                    is_reasoning = true;
                    tracing::info!("💡 [{}] Reasoning started", log_prefix);
                }
                if !reasoning.is_empty() {
                    if let Some(part) = reasoning_parts
                        .iter_mut()
                        .find(|(part_id, _)| part_id == &id)
                    {
                        part.1.push_str(&reasoning);
                    } else {
                        reasoning_parts.push((id.clone(), reasoning.clone()));
                    }

                    if !callback(reasoning, StreamChunkType::Reasoning) {
                        tracing::info!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(_) => {
                consecutive_errors = 0;
            }
            Err(e) => {
                consecutive_errors += 1;
                let error_str = e.to_string();
                last_error = Some(strip_internal_prefixes(&error_str));

                let is_decode_error = error_str.contains("decoding response body")
                    || error_str.contains("error reading a body")
                    || error_str.contains("connection")
                    || error_str.contains("stream");

                if is_decode_error && !full_content.is_empty() {
                    tracing::error!(
                        "⚠️ [{}] Stream decode error after receiving content, treating as stream end: {}",
                        log_prefix,
                        error_str
                    );
                    break;
                }

                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    tracing::error!(
                        "❌ [{}] Too many consecutive stream errors ({}): {}",
                        log_prefix,
                        consecutive_errors,
                        error_str
                    );
                    if !full_content.is_empty() {
                        tracing::error!(
                            "⚠️ [{}] Returning partial content ({} chars) due to stream errors",
                            log_prefix,
                            full_content.len()
                        );
                        break;
                    }
                    return Err(anyhow::anyhow!("{}", strip_internal_prefixes(&error_str)));
                }

                tracing::error!(
                    "⚠️ [{}] Stream error ({}/{}), continuing: {}",
                    log_prefix,
                    consecutive_errors,
                    MAX_CONSECUTIVE_ERRORS,
                    error_str
                );
            }
        }
    }

    // If stream ended with no content and there were errors, return the error
    if full_content.is_empty()
        && !cancelled
        && let Some(err) = last_error
    {
        let clean_err = strip_internal_prefixes(&err);
        tracing::error!(
            "❌ [{}] Stream ended with no content after error(s), propagating: {}",
            log_prefix,
            clean_err
        );
        return Err(anyhow::anyhow!("{}", clean_err));
    }

    // Flatten the reasoning parts (in correlator order) into one text.
    let full_reasoning: String = reasoning_parts
        .iter()
        .map(|(_, text)| text.as_str())
        .collect();

    // Parse thinking content from XML tags in the text
    let parsed = thinking_parser::parse_thinking_content(&full_content);

    // Combine API-provided reasoning with XML-parsed thinking content
    let final_thinking = if !full_reasoning.is_empty() {
        Some(full_reasoning.trim().to_string())
    } else {
        parsed.thinking_content
    };

    // Handle case where reasoning was active when stream ended
    if is_reasoning {
        tracing::info!("💡 [{}] Reasoning ended", log_prefix);
    }

    if cancelled {
        tracing::warn!("⚠️ [{}] Stream was cancelled", log_prefix);
    } else {
        tracing::info!("✅ [{}] Stream completed successfully", log_prefix);
    }

    tracing::info!(
        "📊 [{}] Parsed content: {} chars, API reasoning: {} chars, final thinking: {}",
        log_prefix,
        parsed.content.len(),
        full_reasoning.len(),
        final_thinking.is_some()
    );
    Ok(ChatResponse {
        content: parsed.content,
        thinking_content: final_thinking,
        tokens: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::convert::Infallible;
    use std::sync::{Arc, Mutex};

    use rig::agent::AgentBuilder;
    use rig::completion::{
        CompletionError, CompletionModel, CompletionRequest, CompletionResponse, Usage,
    };
    use rig::message::{ImageMediaType, ReasoningContent};
    use rig::streaming::{
        RawStreamingChoice, RawStreamingToolCall, StreamFinal, StreamPartId,
        StreamingCompletionResponse, WireId,
    };
    use rig::tool::{Tool, ToolContext};
    use serde::Deserialize;
    use serde_json::json;

    /// One raw provider event, yielded by the scripted model in order.
    type MockEvent = Result<RawStreamingChoice, CompletionError>;

    fn text_event(text: &str) -> MockEvent {
        Ok(RawStreamingChoice::Message(text.to_string()))
    }

    fn reasoning_delta_event(id: &str, text: &str) -> MockEvent {
        Ok(RawStreamingChoice::ReasoningDelta {
            id: StreamPartId::wire(id),
            provider_id: None,
            reasoning: text.to_string(),
        })
    }

    /// A wire-sent reasoning block end restating the whole block text — the
    /// shape Anthropic emits at `content_block_stop` after thinking deltas.
    fn reasoning_restatement_event(id: &str, text: &str) -> MockEvent {
        Ok(RawStreamingChoice::ReasoningEnd {
            id: StreamPartId::wire(id),
            reasoning: Some(Reasoning {
                id: None,
                content: vec![ReasoningContent::Text {
                    text: text.to_string(),
                    signature: None,
                }],
            }),
            signature: None,
            wire_sent: true,
        })
    }

    fn reasoning_block_event(id: &str, content: ReasoningContent) -> MockEvent {
        Ok(RawStreamingChoice::Reasoning {
            id: StreamPartId::wire(id),
            provider_id: None,
            content,
        })
    }

    fn tool_call_event(call_id: &str, name: &str, arguments: serde_json::Value) -> MockEvent {
        Ok(RawStreamingChoice::ToolCall(RawStreamingToolCall {
            id: StreamPartId::wire(call_id),
            tool_id: WireId::new(call_id),
            internal_call_id: format!("internal-{call_id}"),
            call_id: Some(call_id.to_string()),
            name: name.to_string(),
            arguments,
            signature: None,
            additional_params: None,
        }))
    }

    fn final_event() -> MockEvent {
        Ok(RawStreamingChoice::FinalResponse(StreamFinal::new(
            "mock",
            Usage::new(),
        )))
    }

    fn error_event(message: &str) -> MockEvent {
        Err(CompletionError::ProviderError(message.to_string()))
    }

    /// Deterministic offline completion model: each model call pops the next
    /// scripted turn of raw provider events. Being called more times than
    /// scripted fails the test.
    struct ScriptedModel {
        turns: Arc<Mutex<VecDeque<Vec<MockEvent>>>>,
    }

    impl CompletionModel for ScriptedModel {
        async fn completion(
            &self,
            _request: CompletionRequest,
        ) -> Result<CompletionResponse, CompletionError> {
            Err(CompletionError::ResponseError(
                "non-streaming completion is not scripted".to_string(),
            ))
        }

        async fn stream(
            &self,
            _request: CompletionRequest,
        ) -> Result<StreamingCompletionResponse, CompletionError> {
            let events = self
                .turns
                .lock()
                .unwrap()
                .pop_front()
                .expect("scripted model was called more times than scripted");
            Ok(StreamingCompletionResponse::stream(
                "mock",
                Box::pin(futures::stream::iter(events)),
            ))
        }
    }

    #[derive(Deserialize)]
    struct EchoArgs {
        text: String,
    }

    /// Minimal registered tool whose result ("echo: <text>") is recognizable
    /// in the tool-result chunks observed through the callback.
    struct EchoTool;

    impl Tool for EchoTool {
        const NAME: &'static str = "echo";
        type Args = EchoArgs;
        type Output = String;
        type Error = Infallible;

        fn description(&self) -> String {
            "Echo the text argument back".to_string()
        }

        fn parameters(&self) -> serde_json::Value {
            json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            })
        }

        async fn call(
            &self,
            _context: &mut ToolContext,
            args: EchoArgs,
        ) -> Result<String, Infallible> {
            Ok(format!("echo: {}", args.text))
        }
    }

    fn build_agent(turns: Vec<Vec<MockEvent>>, with_echo_tool: bool) -> Agent {
        let model = ScriptedModel {
            turns: Arc::new(Mutex::new(turns.into())),
        };
        if with_echo_tool {
            AgentBuilder::new(model).tool(EchoTool).build()
        } else {
            AgentBuilder::new(model).build()
        }
    }

    /// Comparable snapshot of one callback chunk (payload plus type).
    #[derive(Debug, PartialEq)]
    enum Chunk {
        Text(String),
        Reasoning(String),
        ToolCall {
            id: String,
            call_id: Option<String>,
            name: String,
            input: String,
        },
        ToolResult {
            id: String,
            output: String,
        },
        Image(String),
    }

    fn normalize(payload: &str, kind: &StreamChunkType) -> Chunk {
        match kind {
            StreamChunkType::Text => Chunk::Text(payload.to_string()),
            StreamChunkType::Reasoning => Chunk::Reasoning(payload.to_string()),
            StreamChunkType::ToolCall(info) => Chunk::ToolCall {
                id: info.id.clone(),
                call_id: info.call_id.clone(),
                name: info.tool_name.clone(),
                input: info.tool_input.clone(),
            },
            StreamChunkType::ToolResult(info) => Chunk::ToolResult {
                id: info.id.clone(),
                output: info.tool_output.clone(),
            },
            StreamChunkType::Image(url) => Chunk::Image(url.clone()),
        }
    }

    /// Run `stream_agent` over the scripted turns, recording every callback
    /// chunk in order.
    async fn record(
        turns: Vec<Vec<MockEvent>>,
        with_echo_tool: bool,
    ) -> (anyhow::Result<ChatResponse>, Vec<Chunk>) {
        let mut chunks: Vec<Chunk> = Vec::new();
        let result = stream_agent(
            build_agent(turns, with_echo_tool),
            Message::user("test prompt"),
            Vec::new(),
            CancellationToken::new(),
            |payload, kind| {
                chunks.push(normalize(&payload, &kind));
                true
            },
            "test",
        )
        .await;
        (result, chunks)
    }

    fn base64_image(data: &str, media_type: Option<ImageMediaType>) -> AssistantContent {
        AssistantContent::Image(Image {
            data: DocumentSourceKind::Base64(data.to_string()),
            media_type,
            detail: None,
            additional_params: None,
        })
    }

    #[test]
    fn strip_internal_prefixes_removes_each_known_prefix() {
        assert_eq!(strip_internal_prefixes("CompletionError: boom"), "boom");
        assert_eq!(strip_internal_prefixes("ProviderError: boom"), "boom");
        assert_eq!(
            strip_internal_prefixes("Error sending request: boom"),
            "boom"
        );
        assert_eq!(strip_internal_prefixes("HTTP error: boom"), "boom");
        assert_eq!(
            strip_internal_prefixes(
                "CompletionError: ProviderError: Error sending request: HTTP error: boom"
            ),
            "boom"
        );
    }

    #[test]
    fn strip_internal_prefixes_keeps_text_without_known_prefix() {
        assert_eq!(strip_internal_prefixes("rate limited"), "rate limited");
        // Only leading prefixes are stripped; the marker below is mid-string.
        assert_eq!(
            strip_internal_prefixes("after HTTP error: boom"),
            "after HTTP error: boom"
        );
        assert_eq!(strip_internal_prefixes(""), "");
    }

    #[test]
    fn image_data_urls_converts_base64_with_media_type() {
        let content = vec![
            base64_image("aGk=", Some(ImageMediaType::JPEG)),
            base64_image("eHg=", None),
        ];
        assert_eq!(
            image_data_urls(&content),
            vec![
                "data:image/jpeg;base64,aGk=".to_string(),
                // Missing media type falls back to PNG.
                "data:image/png;base64,eHg=".to_string(),
            ]
        );
    }

    #[test]
    fn image_data_urls_passes_urls_through_ignoring_media_type() {
        let content = vec![AssistantContent::Image(Image {
            data: DocumentSourceKind::Url("https://example.test/a.png".to_string()),
            media_type: Some(ImageMediaType::PNG),
            detail: None,
            additional_params: None,
        })];
        assert_eq!(
            image_data_urls(&content),
            vec!["https://example.test/a.png".to_string()]
        );
    }

    #[test]
    fn image_data_urls_skips_non_image_content_and_other_sources() {
        let content = vec![
            AssistantContent::text("not an image"),
            AssistantContent::Image(Image {
                data: DocumentSourceKind::FileId("file-1".to_string()),
                media_type: Some(ImageMediaType::PNG),
                detail: None,
                additional_params: None,
            }),
            AssistantContent::Image(Image {
                data: DocumentSourceKind::Raw(vec![1, 2, 3]),
                media_type: None,
                detail: None,
                additional_params: None,
            }),
            base64_image("aGk=", Some(ImageMediaType::PNG)),
        ];
        assert_eq!(
            image_data_urls(&content),
            vec!["data:image/png;base64,aGk=".to_string()]
        );
    }

    #[tokio::test]
    async fn text_deltas_stream_in_order_and_aggregate() {
        let (result, chunks) = record(
            vec![vec![
                text_event("Hello"),
                text_event(", "),
                text_event("world"),
                final_event(),
            ]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "Hello, world");
        assert_eq!(response.thinking_content, None);
        assert_eq!(response.tokens, None);
        assert_eq!(
            chunks,
            vec![
                Chunk::Text("Hello".into()),
                Chunk::Text(", ".into()),
                Chunk::Text("world".into()),
            ]
        );
    }

    #[tokio::test]
    async fn empty_text_deltas_are_not_forwarded() {
        let (result, chunks) = record(
            vec![vec![text_event(""), text_event("Hi"), final_event()]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "Hi");
        assert_eq!(chunks, vec![Chunk::Text("Hi".into())]);
    }

    #[tokio::test]
    async fn reasoning_deltas_stream_and_become_thinking_content() {
        let (result, chunks) = record(
            vec![vec![
                reasoning_delta_event("r1", "Plan "),
                reasoning_delta_event("r1", "steps"),
                text_event("The answer"),
                final_event(),
            ]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "The answer");
        assert_eq!(response.thinking_content, Some("Plan steps".to_string()));
        assert_eq!(
            chunks,
            vec![
                Chunk::Reasoning("Plan ".into()),
                Chunk::Reasoning("steps".into()),
                Chunk::Text("The answer".into()),
            ]
        );
    }

    #[tokio::test]
    async fn reasoning_block_replaces_forwarded_deltas_instead_of_duplicating() {
        // Deltas followed by a wire-sent restatement of the same block (the
        // Anthropic `content_block_stop` shape) must not double the text.
        let (result, chunks) = record(
            vec![vec![
                reasoning_delta_event("r1", "think "),
                reasoning_delta_event("r1", "twice"),
                reasoning_restatement_event("r1", "think twice"),
                text_event("Answer"),
                final_event(),
            ]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.thinking_content, Some("think twice".to_string()));
        assert_eq!(response.content, "Answer");
        assert_eq!(
            chunks,
            vec![
                Chunk::Reasoning("think ".into()),
                Chunk::Reasoning("twice".into()),
                Chunk::Text("Answer".into()),
            ]
        );
    }

    #[tokio::test]
    async fn reasoning_block_replaces_divergent_delta_text() {
        // A completed block whose text differs from its deltas supersedes
        // them in the aggregated thinking content.
        let (result, chunks) = record(
            vec![vec![
                reasoning_delta_event("r1", "par"),
                reasoning_restatement_event("r1", "partial final"),
                final_event(),
            ]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.thinking_content, Some("partial final".to_string()));
        assert_eq!(chunks, vec![Chunk::Reasoning("par".into())]);
    }

    #[tokio::test]
    async fn standalone_reasoning_blocks_stream_once_in_order() {
        let (result, chunks) = record(
            vec![vec![
                reasoning_block_event(
                    "r2",
                    ReasoningContent::Text {
                        text: "plain".to_string(),
                        signature: None,
                    },
                ),
                reasoning_block_event("r3", ReasoningContent::Summary("summed".to_string())),
                // Encrypted payloads carry no displayable text.
                reasoning_block_event("r4", ReasoningContent::Encrypted("opaque".to_string())),
                text_event("ok"),
                final_event(),
            ]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.thinking_content, Some("plainsummed".to_string()));
        assert_eq!(response.content, "ok");
        assert_eq!(
            chunks,
            vec![
                Chunk::Reasoning("plain".into()),
                Chunk::Reasoning("summed".into()),
                Chunk::Text("ok".into()),
            ]
        );
    }

    #[tokio::test]
    async fn reasoning_only_turn_returns_empty_content_with_thinking() {
        let (result, chunks) = record(
            vec![vec![
                reasoning_delta_event("r1", "only thoughts"),
                final_event(),
            ]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "");
        assert_eq!(response.thinking_content, Some("only thoughts".to_string()));
        assert_eq!(chunks, vec![Chunk::Reasoning("only thoughts".into())]);
    }

    #[tokio::test]
    async fn tool_call_lifecycle_correlates_call_and_result_in_order() {
        let (result, chunks) = record(
            vec![
                vec![
                    text_event("Checking."),
                    tool_call_event("call-1", "echo", json!({"text": "hi"})),
                    final_event(),
                ],
                vec![text_event("Done"), final_event()],
            ],
            true,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "Checking.Done");
        assert_eq!(response.thinking_content, None);
        assert_eq!(
            chunks,
            vec![
                Chunk::Text("Checking.".into()),
                Chunk::ToolCall {
                    id: "call-1".into(),
                    call_id: Some("call-1".into()),
                    name: "echo".into(),
                    input: r#"{"text":"hi"}"#.into(),
                },
                Chunk::ToolResult {
                    id: "call-1".into(),
                    output: "echo: hi".into(),
                },
                Chunk::Text("Done".into()),
            ]
        );
    }

    #[tokio::test]
    async fn sequential_tool_calls_report_both_results_in_call_order() {
        let (result, chunks) = record(
            vec![
                vec![
                    tool_call_event("call-1", "echo", json!({"text": "first"})),
                    tool_call_event("call-2", "echo", json!({"text": "second"})),
                    final_event(),
                ],
                vec![text_event("after tools"), final_event()],
            ],
            true,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "after tools");
        assert_eq!(
            chunks,
            vec![
                Chunk::ToolCall {
                    id: "call-1".into(),
                    call_id: Some("call-1".into()),
                    name: "echo".into(),
                    input: r#"{"text":"first"}"#.into(),
                },
                Chunk::ToolCall {
                    id: "call-2".into(),
                    call_id: Some("call-2".into()),
                    name: "echo".into(),
                    input: r#"{"text":"second"}"#.into(),
                },
                Chunk::ToolResult {
                    id: "call-1".into(),
                    output: "echo: first".into(),
                },
                Chunk::ToolResult {
                    id: "call-2".into(),
                    output: "echo: second".into(),
                },
                Chunk::Text("after tools".into()),
            ]
        );
    }

    #[tokio::test]
    async fn decode_error_after_content_returns_partial_content() {
        let (result, chunks) = record(
            vec![vec![
                text_event("Partial answer"),
                error_event("error decoding response body: connection closed"),
            ]],
            false,
        )
        .await;
        let response = result.expect("partial content should be returned");
        assert_eq!(response.content, "Partial answer");
        assert_eq!(chunks, vec![Chunk::Text("Partial answer".into())]);
    }

    #[tokio::test]
    async fn non_decode_error_after_content_returns_partial_content() {
        let (result, chunks) = record(
            vec![vec![text_event("Hello"), error_event("rate limited")]],
            false,
        )
        .await;
        let response = result.expect("received content should be kept");
        assert_eq!(response.content, "Hello");
        assert_eq!(chunks, vec![Chunk::Text("Hello".into())]);
    }

    #[tokio::test]
    async fn provider_error_with_no_content_propagates_stripped_message() {
        let (result, chunks) = record(vec![vec![error_event("boom")]], false).await;
        let error = result.expect_err("empty stream after error should fail");
        // The "ProviderError: " wrapper is stripped for the user-facing error.
        assert_eq!(error.to_string(), "boom");
        assert!(chunks.is_empty());
    }

    #[tokio::test]
    async fn cancelled_token_stops_stream_after_current_chunk() {
        let token = CancellationToken::new();
        let cancel = token.clone();
        let mut chunks: Vec<Chunk> = Vec::new();
        let result = stream_agent(
            build_agent(
                vec![vec![
                    text_event("Hel"),
                    text_event("lo"),
                    text_event(" world"),
                    final_event(),
                ]],
                false,
            ),
            Message::user("test prompt"),
            Vec::new(),
            token,
            |payload, kind| {
                chunks.push(normalize(&payload, &kind));
                cancel.cancel();
                true
            },
            "test",
        )
        .await
        .expect("cancelled stream returns the content received so far");
        assert_eq!(chunks, vec![Chunk::Text("Hel".into())]);
        assert_eq!(result.content, "Hel");
    }

    #[tokio::test]
    async fn callback_false_stops_stream_with_partial_content() {
        let mut chunks: Vec<Chunk> = Vec::new();
        let result = stream_agent(
            build_agent(
                vec![vec![text_event("A"), text_event("B"), final_event()]],
                false,
            ),
            Message::user("test prompt"),
            Vec::new(),
            CancellationToken::new(),
            |payload, kind| {
                chunks.push(normalize(&payload, &kind));
                false
            },
            "test",
        )
        .await
        .expect("callback cancellation returns the content received so far");
        assert_eq!(chunks, vec![Chunk::Text("A".into())]);
        assert_eq!(result.content, "A");
    }

    #[tokio::test]
    async fn xml_thinking_tags_are_extracted_from_streamed_text() {
        let (result, chunks) = record(
            vec![vec![
                text_event("<think>hidden step</think>The answer"),
                final_event(),
            ]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "The answer");
        assert_eq!(response.thinking_content, Some("hidden step".to_string()));
        assert_eq!(
            chunks,
            vec![Chunk::Text("<think>hidden step</think>The answer".into())]
        );
    }

    #[tokio::test]
    async fn api_reasoning_takes_precedence_over_xml_thinking() {
        let (result, _chunks) = record(
            vec![vec![
                reasoning_delta_event("r1", "model thoughts"),
                text_event("<think>xml thoughts</think>visible"),
                final_event(),
            ]],
            false,
        )
        .await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "visible");
        assert_eq!(
            response.thinking_content,
            Some("model thoughts".to_string())
        );
    }

    #[tokio::test]
    async fn empty_stream_completes_with_empty_response() {
        let (result, chunks) = record(vec![vec![final_event()]], false).await;
        let response = result.expect("stream should succeed");
        assert_eq!(response.content, "");
        assert_eq!(response.thinking_content, None);
        assert!(chunks.is_empty());
    }
}
