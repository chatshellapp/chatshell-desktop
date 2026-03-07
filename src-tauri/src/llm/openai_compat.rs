//! OpenAI Chat Completions-compatible CompletionModel.
//!
//! Supports both array-style content (text + images) and plain-string content.
//! By default, user messages are serialized as an array of content parts so that
//! multimodal inputs (images) are preserved. Providers that only accept the simple
//! string format (e.g. DeepSeek, Baichuan, MiniMax, Xirang) can opt out via
//! `CompletionModel::with_string_content_only()`.
//!
//! Uses `moonshot::Client` for HTTP transport and reuses OpenAI response types.
//! Includes custom streaming implementation with `reasoning_content` support
//! for providers like MiniMax that use the DeepSeek-style reasoning format.

use rig::completion::{self, CompletionError, CompletionRequest};
use rig::http_client::{self, HttpClientExt};
use rig::message::{self, AssistantContent, DocumentSourceKind, ImageMediaType, UserContent};
use rig::providers::moonshot;
use rig::providers::openai;
use rig::streaming;
use serde::{Deserialize, Deserializer, Serialize};
use tracing::{Instrument, info_span};

fn deserialize_null_or_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    let opt: Option<Vec<T>> = Option::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

/// Merge two JSON values (second overwrites first for conflicts).
fn merge_json(base: serde_json::Value, overrides: serde_json::Value) -> serde_json::Value {
    match (base, overrides) {
        (serde_json::Value::Object(mut a), serde_json::Value::Object(b)) => {
            for (k, v) in b {
                a.insert(k, v);
            }
            serde_json::Value::Object(a)
        }
        (_, b) => b,
    }
}

// ================================================================
// Message types (OpenAI-compatible)
// ================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text { text: String },
    ImageUrl { image_url: ImageUrlContent },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageUrlContent {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum UserMessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum SimpleMessage {
    System {
        content: String,
    },
    User {
        content: UserMessageContent,
    },
    Assistant {
        content: String,
        #[serde(
            default,
            skip_serializing_if = "Vec::is_empty",
            deserialize_with = "deserialize_null_or_vec"
        )]
        tool_calls: Vec<openai::ToolCall>,
    },
    #[serde(rename = "tool")]
    ToolResult {
        tool_call_id: String,
        content: String,
    },
}

impl SimpleMessage {
    pub fn system(content: impl Into<String>) -> Self {
        SimpleMessage::System {
            content: content.into(),
        }
    }
}

fn image_media_type_to_mime(mt: &ImageMediaType) -> &'static str {
    match mt {
        ImageMediaType::JPEG => "image/jpeg",
        ImageMediaType::PNG => "image/png",
        ImageMediaType::GIF => "image/gif",
        ImageMediaType::WEBP => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Convert a rig `Message` into one or more `SimpleMessage`s.
/// Tool results are split into separate messages (one per tool result).
///
/// When `supports_array_content` is true, user messages with images are serialized
/// as an array of content parts (text + image_url). When false, images are dropped
/// and content is flattened to a plain string.
fn convert_message(msg: message::Message, supports_array_content: bool) -> Vec<SimpleMessage> {
    match msg {
        message::Message::User { content } => {
            let (tool_results, other): (Vec<_>, Vec<_>) = content
                .into_iter()
                .partition(|c| matches!(c, UserContent::ToolResult(_)));

            if !tool_results.is_empty() {
                tool_results
                    .into_iter()
                    .filter_map(|c| {
                        if let UserContent::ToolResult(tr) = c {
                            let text = tr
                                .content
                                .iter()
                                .filter_map(|tc| match tc {
                                    message::ToolResultContent::Text(t) => Some(t.text.clone()),
                                    _ => None,
                                })
                                .collect::<Vec<_>>()
                                .join("\n");
                            Some(SimpleMessage::ToolResult {
                                tool_call_id: tr.id,
                                content: text,
                            })
                        } else {
                            None
                        }
                    })
                    .collect()
            } else if supports_array_content {
                let parts: Vec<ContentPart> = other
                    .into_iter()
                    .filter_map(|c| match c {
                        UserContent::Text(t) => Some(ContentPart::Text { text: t.text }),
                        UserContent::Image(img) => {
                            let mime = img
                                .media_type
                                .as_ref()
                                .map(|mt| image_media_type_to_mime(mt))
                                .unwrap_or("application/octet-stream");
                            let b64 = match &img.data {
                                DocumentSourceKind::Base64(s) => s.clone(),
                                DocumentSourceKind::String(s) => s.clone(),
                                _ => return None,
                            };
                            let url = format!("data:{};base64,{}", mime, b64);
                            let detail = img.detail.as_ref().map(|d| match d {
                                message::ImageDetail::Auto => "auto".to_string(),
                                message::ImageDetail::High => "high".to_string(),
                                message::ImageDetail::Low => "low".to_string(),
                                _ => "auto".to_string(),
                            });
                            Some(ContentPart::ImageUrl {
                                image_url: ImageUrlContent { url, detail },
                            })
                        }
                        UserContent::Document(doc) => match &doc.data {
                            DocumentSourceKind::String(s) | DocumentSourceKind::Base64(s) => {
                                Some(ContentPart::Text { text: s.clone() })
                            }
                            _ => None,
                        },
                        _ => None,
                    })
                    .collect();

                // Optimize: single text part -> use plain string for efficiency
                if parts.len() == 1 && matches!(&parts[0], ContentPart::Text { .. }) {
                    if let ContentPart::Text { text } = parts.into_iter().next().unwrap() {
                        vec![SimpleMessage::User {
                            content: UserMessageContent::Text(text),
                        }]
                    } else {
                        unreachable!()
                    }
                } else {
                    vec![SimpleMessage::User {
                        content: UserMessageContent::Parts(parts),
                    }]
                }
            } else {
                let text = other
                    .iter()
                    .filter_map(|c| match c {
                        UserContent::Text(t) => Some(t.text.clone()),
                        UserContent::Document(doc) => match &doc.data {
                            DocumentSourceKind::String(s) | DocumentSourceKind::Base64(s) => {
                                Some(s.clone())
                            }
                            _ => None,
                        },
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                vec![SimpleMessage::User {
                    content: UserMessageContent::Text(text),
                }]
            }
        }
        message::Message::Assistant { content, .. } => {
            let (text_parts, tool_calls): (Vec<_>, Vec<_>) = content
                .into_iter()
                .partition(|c| !matches!(c, AssistantContent::ToolCall(_)));

            let text = text_parts
                .iter()
                .filter_map(|c| match c {
                    AssistantContent::Text(t) => Some(t.text.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("");

            let tc: Vec<openai::ToolCall> = tool_calls
                .into_iter()
                .filter_map(|c| {
                    if let AssistantContent::ToolCall(tc) = c {
                        Some(tc.into())
                    } else {
                        None
                    }
                })
                .collect();

            vec![SimpleMessage::Assistant {
                content: text,
                tool_calls: tc,
            }]
        }
    }
}

// ================================================================
// Request type
// ================================================================

#[derive(Debug, Serialize, Deserialize)]
struct CompatCompletionRequest {
    model: String,
    messages: Vec<SimpleMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<openai::ToolDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<openai::ToolChoice>,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    additional_params: Option<serde_json::Value>,
}

impl CompatCompletionRequest {
    fn from_completion_request(
        model: &str,
        req: CompletionRequest,
        supports_array_content: bool,
    ) -> Result<Self, CompletionError> {
        let mut partial_history = vec![];
        if let Some(docs) = req.normalized_documents() {
            partial_history.push(docs);
        }
        partial_history.extend(req.chat_history);

        let mut full_history: Vec<SimpleMessage> = match &req.preamble {
            Some(preamble) => vec![SimpleMessage::system(preamble)],
            None => vec![],
        };

        for msg in partial_history {
            full_history.extend(convert_message(msg, supports_array_content));
        }

        let tool_choice = req
            .tool_choice
            .map(openai::ToolChoice::try_from)
            .transpose()?;

        Ok(Self {
            model: model.to_string(),
            messages: full_history,
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            tools: req
                .tools
                .into_iter()
                .map(openai::ToolDefinition::from)
                .collect(),
            tool_choice,
            additional_params: req.additional_params,
        })
    }
}

// ================================================================
// Response parsing (reuse moonshot/openai types)
// ================================================================

#[derive(Debug, Deserialize)]
struct ApiErrorResponse {
    error: CompatError,
}

#[derive(Debug, Deserialize)]
struct CompatError {
    message: String,
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    code: Option<serde_json::Value>,
}

impl CompatError {
    fn format_message(&self) -> String {
        let code_str = self.code.as_ref().and_then(|c| match c {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            _ => None,
        });

        let mut parts = Vec::new();
        if let Some(ref code) = code_str {
            parts.push(format!("[{}]", code));
        } else if let Some(ref t) = self.r#type {
            parts.push(format!("[{}]", t));
        }
        parts.push(self.message.clone());
        parts.join(" ")
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ApiResponse<T> {
    Ok(T),
    Err(ApiErrorResponse),
}

// ================================================================
// CompletionModel implementation
// ================================================================

#[derive(Clone)]
pub struct CompletionModel<T = reqwest::Client> {
    client: moonshot::Client<T>,
    pub model: String,
    supports_array_content: bool,
}

impl<T> CompletionModel<T> {
    pub fn new(client: moonshot::Client<T>, model: impl Into<String>) -> Self {
        Self {
            client,
            model: model.into(),
            supports_array_content: true,
        }
    }

    /// Disable array-style content for providers that only accept plain string content.
    /// Images will be dropped and all user content flattened to a single string.
    pub fn with_string_content_only(mut self) -> Self {
        self.supports_array_content = false;
        self
    }
}

impl<T> completion::CompletionModel for CompletionModel<T>
where
    T: HttpClientExt + Clone + Default + std::fmt::Debug + Send + Sync + 'static,
{
    type Response = openai::CompletionResponse;
    type StreamingResponse = openai::StreamingCompletionResponse;
    type Client = moonshot::Client<T>;

    fn make(client: &Self::Client, model: impl Into<String>) -> Self {
        Self::new(client.clone(), model)
    }

    async fn completion(
        &self,
        completion_request: CompletionRequest,
    ) -> Result<completion::CompletionResponse<openai::CompletionResponse>, CompletionError> {
        let preamble = completion_request.preamble.clone();
        let request = CompatCompletionRequest::from_completion_request(
            self.model.as_ref(),
            completion_request,
            self.supports_array_content,
        )?;

        tracing::trace!(
            "OpenAI-compat API input: {request}",
            request = serde_json::to_string_pretty(&request).unwrap()
        );

        let span = if tracing::Span::current().is_disabled() {
            info_span!(
                target: "rig::completions",
                "chat",
                gen_ai.operation.name = "chat",
                gen_ai.system_instructions = preamble,
                gen_ai.request.model = self.model,
                gen_ai.response.id = tracing::field::Empty,
                gen_ai.response.model = tracing::field::Empty,
                gen_ai.usage.output_tokens = tracing::field::Empty,
                gen_ai.usage.input_tokens = tracing::field::Empty,
            )
        } else {
            tracing::Span::current()
        };

        let body = serde_json::to_vec(&request)?;
        let req = self
            .client
            .post("/chat/completions")?
            .body(body)
            .map_err(http_client::Error::from)?;

        let async_block = async move {
            let response = self.client.send(req).await?;

            let status = response.status();
            let response_text = http_client::text(response).await?;

            if status.is_success() {
                match serde_json::from_str::<ApiResponse<openai::CompletionResponse>>(
                    &response_text,
                )? {
                    ApiResponse::Ok(response) => {
                        tracing::trace!(
                            target: "rig::completions",
                            "OpenAI-compat completion response: {}",
                            serde_json::to_string_pretty(&response)?
                        );
                        response.try_into()
                    }
                    ApiResponse::Err(err) => {
                        Err(CompletionError::ProviderError(err.error.format_message()))
                    }
                }
            } else {
                let formatted =
                    if let Ok(api_err) = serde_json::from_str::<ApiErrorResponse>(&response_text) {
                        format!(
                            "[HTTP {}] {}",
                            status.as_u16(),
                            api_err.error.format_message()
                        )
                    } else {
                        format!("[HTTP {}] {}", status.as_u16(), response_text)
                    };
                Err(CompletionError::ProviderError(formatted))
            }
        };

        async_block.instrument(span).await
    }

    async fn stream(
        &self,
        request: CompletionRequest,
    ) -> Result<streaming::StreamingCompletionResponse<Self::StreamingResponse>, CompletionError>
    {
        let preamble = request.preamble.clone();
        let mut request = CompatCompletionRequest::from_completion_request(
            self.model.as_ref(),
            request,
            self.supports_array_content,
        )?;

        let span = if tracing::Span::current().is_disabled() {
            info_span!(
                target: "rig::completions",
                "chat_streaming",
                gen_ai.operation.name = "chat",
                gen_ai.system_instructions = preamble,
                gen_ai.request.model = self.model,
                gen_ai.response.id = tracing::field::Empty,
                gen_ai.response.model = tracing::field::Empty,
                gen_ai.usage.output_tokens = tracing::field::Empty,
                gen_ai.usage.input_tokens = tracing::field::Empty,
            )
        } else {
            tracing::Span::current()
        };

        let params = merge_json(
            request.additional_params.unwrap_or(serde_json::json!({})),
            serde_json::json!({"stream": true}),
        );
        request.additional_params = Some(params);

        tracing::info!(
            "OpenAI-compat streaming request: {}",
            serde_json::to_string_pretty(&request).unwrap_or_default()
        );

        let body = serde_json::to_vec(&request)?;
        let mut req = self
            .client
            .post("/chat/completions")?
            .body(body)
            .map_err(http_client::Error::from)?;

        req.headers_mut().insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );

        send_compat_streaming_request_with_reasoning(self.client.clone(), req)
            .instrument(span)
            .await
    }
}

// ================================================================
// Custom streaming with reasoning_content support
// ================================================================

#[derive(Deserialize, Debug)]
struct CompatStreamingFunction {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Deserialize, Debug)]
struct CompatStreamingToolCall {
    index: usize,
    id: Option<String>,
    function: CompatStreamingFunction,
}

#[derive(Deserialize, Debug)]
struct CompatStreamingDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::llm::openai_compat::deserialize_null_or_vec"
    )]
    tool_calls: Vec<CompatStreamingToolCall>,
}

#[derive(Deserialize, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
enum CompatFinishReason {
    ToolCalls,
    Stop,
    ContentFilter,
    Length,
    #[serde(untagged)]
    Other(String),
}

#[derive(Deserialize, Debug)]
struct CompatStreamingChoice {
    delta: CompatStreamingDelta,
    finish_reason: Option<CompatFinishReason>,
}

#[derive(Deserialize, Debug, Default)]
struct CompatUsage {
    #[serde(default)]
    prompt_tokens: usize,
    #[serde(default)]
    total_tokens: usize,
}

impl From<CompatUsage> for openai::completion::Usage {
    fn from(u: CompatUsage) -> Self {
        openai::completion::Usage {
            prompt_tokens: u.prompt_tokens,
            total_tokens: u.total_tokens,
            prompt_tokens_details: None,
        }
    }
}

#[derive(Deserialize, Debug)]
struct CompatStreamingChunk {
    choices: Vec<CompatStreamingChoice>,
    usage: Option<CompatUsage>,
}

async fn send_compat_streaming_request_with_reasoning<T>(
    http_client: T,
    req: http::Request<Vec<u8>>,
) -> Result<
    streaming::StreamingCompletionResponse<openai::StreamingCompletionResponse>,
    CompletionError,
>
where
    T: HttpClientExt + Clone + 'static,
{
    use async_stream::stream;
    use futures::StreamExt;
    use rig::http_client::sse::{Event, GenericEventSource};
    use rig::message::{ToolCall, ToolFunction};
    use std::collections::HashMap;

    let mut event_source = GenericEventSource::new(http_client, req);

    let stream = stream! {
        let mut tool_calls: HashMap<usize, ToolCall> = HashMap::new();
        let mut tool_call_raw_args: HashMap<usize, String> = HashMap::new();
        let mut final_usage = None;

        while let Some(event_result) = event_source.next().await {
            match event_result {
                Ok(Event::Open) => {
                    tracing::trace!("SSE connection opened");
                    continue;
                }
                Ok(Event::Message(message)) => {
                    if message.data.trim().is_empty() || message.data == "[DONE]" {
                        continue;
                    }

                    let data = match serde_json::from_str::<CompatStreamingChunk>(&message.data) {
                        Ok(data) => data,
                        Err(parse_error) => {
                            if let Ok(api_err) = serde_json::from_str::<ApiErrorResponse>(&message.data) {
                                tracing::error!(
                                    error_message = %api_err.error.message,
                                    error_type = ?api_err.error.r#type,
                                    error_code = ?api_err.error.code,
                                    "API error in SSE stream"
                                );
                                yield Err(CompletionError::ProviderError(api_err.error.format_message()));
                                break;
                            }
                            tracing::error!(
                                ?parse_error,
                                message = message.data,
                                "Failed to parse SSE message"
                            );
                            continue;
                        }
                    };

                    let Some(choice) = data.choices.first() else {
                        tracing::debug!("No choice in streaming chunk");
                        continue;
                    };
                    let delta = &choice.delta;

                    if !delta.tool_calls.is_empty() {
                        for tool_call in &delta.tool_calls {
                            let index = tool_call.index;

                            let existing_tool_call =
                                tool_calls.entry(index).or_insert_with(|| ToolCall {
                                    id: String::new(),
                                    call_id: None,
                                    function: ToolFunction {
                                        name: String::new(),
                                        arguments: serde_json::Value::Null,
                                    },
                                    signature: None,
                                    additional_params: None,
                                });

                            if let Some(id) = &tool_call.id {
                                if !id.is_empty() {
                                    existing_tool_call.id = id.clone();
                                }
                            }

                            if let Some(name) = &tool_call.function.name {
                                if !name.is_empty() {
                                    existing_tool_call.function.name = name.clone();
                                }
                            }

                            if let Some(chunk) = &tool_call.function.arguments {
                                tool_call_raw_args
                                    .entry(index)
                                    .or_default()
                                    .push_str(chunk);

                                yield Ok(streaming::RawStreamingChoice::ToolCallDelta {
                                    id: existing_tool_call.id.clone(),
                                    internal_call_id: String::new(),
                                    content: streaming::ToolCallDeltaContent::Delta(chunk.clone()),
                                });
                            }
                        }
                    }

                    // Emit reasoning content (MiniMax M1, DeepSeek-R1 style)
                    if let Some(reasoning) = &delta.reasoning_content {
                        if !reasoning.is_empty() {
                            yield Ok(streaming::RawStreamingChoice::Reasoning {
                                id: None,
                                content: rig::message::ReasoningContent::Text {
                                    text: reasoning.clone(),
                                    signature: None,
                                },
                            });
                        }
                    }

                    if let Some(content) = &delta.content {
                        if !content.is_empty() {
                            yield Ok(streaming::RawStreamingChoice::Message(content.clone()));
                        }
                    }

                    if let Some(usage) = data.usage {
                        final_usage = Some(usage);
                    }
                }
                Err(rig::http_client::Error::StreamEnded) => {
                    break;
                }
                Err(error) => {
                    let error_str = error.to_string();
                    tracing::error!(%error_str, "SSE error");
                    let formatted = if let Some(json_start) = error_str.find('{') {
                        if let Ok(api_err) = serde_json::from_str::<ApiErrorResponse>(&error_str[json_start..]) {
                            api_err.error.format_message()
                        } else {
                            error_str
                        }
                    } else {
                        error_str
                    };
                    yield Err(CompletionError::ProviderError(formatted));
                    break;
                }
            }
        }

        event_source.close();

        for (idx, mut tool_call) in tool_calls.into_iter() {
            if let Some(raw_args) = tool_call_raw_args.remove(&idx) {
                match serde_json::from_str::<serde_json::Value>(&raw_args) {
                    Ok(parsed) => tool_call.function.arguments = parsed,
                    Err(e) => {
                        tracing::warn!(
                            "Failed to parse tool call arguments as JSON (tool: {}): {}",
                            tool_call.function.name,
                            e
                        );
                        tool_call.function.arguments = serde_json::Value::String(raw_args);
                    }
                }
            }

            if tool_call.function.name.is_empty() {
                tracing::warn!(
                    "Skipping tool call with empty name (id: {}, args: {})",
                    tool_call.id,
                    tool_call.function.arguments
                );
                continue;
            }

            yield Ok(streaming::RawStreamingChoice::ToolCall(
                streaming::RawStreamingToolCall::new(
                    tool_call.id,
                    tool_call.function.name,
                    tool_call.function.arguments,
                ),
            ));
        }

        let final_usage: openai::completion::Usage = final_usage.unwrap_or_default().into();

        yield Ok(streaming::RawStreamingChoice::FinalResponse(
            openai::StreamingCompletionResponse { usage: final_usage },
        ));
    };

    Ok(streaming::StreamingCompletionResponse::stream(Box::pin(
        stream,
    )))
}
