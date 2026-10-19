//! Desktop vision-model responder for the read tool's image questions.
//!
//! Implements the agent-core [`ImageQuestionResponder`] seam: the read tool
//! hands over image bytes plus a question, this responder performs a
//! one-shot completion against the resolved auxiliary vision model, and the
//! answer returns as text. Holds a fully resolved model snapshot (captured
//! per turn when the agent is built), so the call needs no runtime lookups.

use chatshell_agent_core::tools::image_question::{ImageInput, ImageQuestionResponder};
use futures::future::BoxFuture;

use crate::llm::{ChatMessage, ImageData, call_provider};

/// System prompt for one-shot image analysis.
const IMAGE_QUESTION_SYSTEM_PROMPT: &str = "You analyze images on behalf of a chat assistant. \
Answer the user's question about the image accurately and concisely, in the same language as the \
question. Describe only what is visible; state uncertainty explicitly instead of guessing. \
If the image cannot be interpreted (corrupt, blank, unsupported), say so.";

/// One-shot vision call backed by a resolved auxiliary vision model.
pub struct VisionQuestionResponder {
    provider_type: String,
    model_id: String,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
}

impl VisionQuestionResponder {
    /// Build from a fully resolved model (see `commands::chat::aux_models`).
    pub fn new(
        provider_type: String,
        model_id: String,
        api_key: Option<String>,
        base_url: Option<String>,
        api_style: Option<String>,
    ) -> Self {
        Self {
            provider_type,
            model_id,
            api_key,
            base_url,
            api_style,
        }
    }
}

impl ImageQuestionResponder for VisionQuestionResponder {
    fn answer(
        &self,
        image: ImageInput,
        question: String,
    ) -> BoxFuture<'static, Result<String, String>> {
        let provider_type = self.provider_type.clone();
        let model_id = self.model_id.clone();
        let api_key = self.api_key.clone();
        let base_url = self.base_url.clone();
        let api_style = self.api_style.clone();

        Box::pin(async move {
            let base64 =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, image.bytes);
            let response = call_provider(
                &provider_type,
                model_id,
                vec![
                    ChatMessage {
                        role: "system".to_string(),
                        content: IMAGE_QUESTION_SYSTEM_PROMPT.to_string(),
                        images: vec![],
                        files: vec![],
                        tool_calls: vec![],
                        tool_call_id: None,
                        tool_result_call_id: None,
                        reasoning_content: None,
                    },
                    ChatMessage {
                        role: "user".to_string(),
                        content: question,
                        images: vec![ImageData {
                            base64,
                            media_type: image.mime_type,
                        }],
                        files: vec![],
                        tool_calls: vec![],
                        tool_call_id: None,
                        tool_result_call_id: None,
                        reasoning_content: None,
                    },
                ],
                api_key,
                base_url,
                api_style,
            )
            .await
            .map_err(|e| e.to_string())?;
            Ok(response.content)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    /// Serve exactly one request with `status`/`body`, capturing the raw
    /// request bytes (headers + body) for assertions.
    async fn serve_one(status: &'static str, body: &'static str) -> (String, Arc<Mutex<Vec<u8>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let captured = Arc::new(Mutex::new(Vec::new()));
        let sink = captured.clone();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 8192];
            let header_end = loop {
                let n = socket.read(&mut chunk).await.unwrap();
                if n == 0 {
                    break 0;
                }
                request.extend_from_slice(&chunk[..n]);
                if let Some(pos) = find_subsequence(&request, b"\r\n\r\n") {
                    break pos + 4;
                }
            };
            let headers = String::from_utf8_lossy(&request[..header_end]).to_string();
            let content_length: usize = headers
                .lines()
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
                .and_then(|(_, v)| v.trim().parse().ok())
                .unwrap_or(0);
            while request.len() < header_end + content_length {
                match socket.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => request.extend_from_slice(&chunk[..n]),
                }
            }
            *sink.lock().unwrap() = request;
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        (format!("http://{address}"), captured)
    }

    fn test_responder(base_url: String) -> VisionQuestionResponder {
        VisionQuestionResponder::new(
            "custom_openai".to_string(),
            "vision-x".to_string(),
            Some("test-key".to_string()),
            Some(base_url),
            Some("chat_completions".to_string()),
        )
    }

    #[tokio::test]
    async fn answer_sends_image_and_question_and_returns_the_reply() {
        let sse = concat!(
            "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,",
            "\"delta\":{\"role\":\"assistant\",\"content\":\"A bar chart of revenue.\"},",
            "\"finish_reason\":null}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (base_url, captured) = serve_one("200 OK", sse).await;
        let responder = test_responder(base_url);

        let bytes = vec![0x89, b'P', b'N', b'G', 0x01, 0x02, 0x03];
        let answer = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            responder.answer(
                ImageInput {
                    bytes: bytes.clone(),
                    mime_type: "image/png".to_string(),
                },
                "What does the chart show?".to_string(),
            ),
        )
        .await
        .expect("responder must finish")
        .expect("provider call must succeed");

        assert_eq!(answer, "A bar chart of revenue.");

        let request = String::from_utf8(captured.lock().unwrap().clone()).unwrap();
        assert!(
            request.contains("Bearer test-key"),
            "api key must ride the request: {request}"
        );
        assert!(
            request.contains("\"model\":\"vision-x\""),
            "model id must be sent: {request}"
        );
        assert!(
            request.contains("What does the chart show?"),
            "question must be sent: {request}"
        );
        assert!(
            request.contains("You analyze images"),
            "system prompt must be sent: {request}"
        );
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        assert!(
            request.contains(&format!("data:image/png;base64,{encoded}")),
            "image bytes must be embedded as a data URL: {request}"
        );
    }

    #[tokio::test]
    async fn provider_failure_surfaces_as_an_answer_error() {
        let (base_url, _captured) = serve_one("500 Internal Server Error", "boom").await;
        let responder = test_responder(base_url);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            responder.answer(
                ImageInput {
                    bytes: vec![1, 2, 3],
                    mime_type: "image/png".to_string(),
                },
                "q".to_string(),
            ),
        )
        .await
        .expect("responder must finish");

        assert!(
            result.is_err(),
            "HTTP 500 must propagate as an error, got {:?}",
            result
        );
    }
}
