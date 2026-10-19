//! Streaming-path regression: the Anthropic wire must authenticate with
//! `x-api-key` on the full desktop chain (`call_provider` → agent streaming
//! → SSE), not only at the client-construction level.
//!
//! Companion to `chatshell-agent-core`'s non-streaming
//! `anthropic_auth_header` test. rig's anthropic client sends
//! `Authorization: Bearer`, which api.anthropic.com accepts but some
//! Anthropic-compatible gateways reject — they only read `X-Api-Key` and
//! answer 401 "login fail".
//! `create_anthropic_completion_model` layers `x-api-key` onto the shared
//! HTTP client so both schemes ride every request. Found by the
//! real-provider smoke eval (CHATSHELL_SMOKE_*).

#[cfg(test)]
mod tests {
    use crate::llm::{ChatMessage, call_provider};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    fn message(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
            images: vec![],
            files: vec![],
            tool_calls: vec![],
            tool_call_id: None,
            tool_result_call_id: None,
            reasoning_content: None,
        }
    }

    /// Serve one Anthropic Messages SSE stream, capturing the raw request
    /// headers for assertions.
    async fn serve_anthropic_stream() -> (String, Arc<Mutex<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let captured = Arc::new(Mutex::new(String::new()));
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
            *sink.lock().unwrap() = headers;

            let body = concat!(
                "data: {\"type\":\"message_start\",\"message\":null}\n\n",
                "data: {\"type\":\"content_block_start\",\"index\":0,",
                "\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
                "data: {\"type\":\"content_block_delta\",\"index\":0,",
                "\"delta\":{\"type\":\"text_delta\",\"text\":\"Streamed\"}}\n\n",
                "data: {\"type\":\"content_block_delta\",\"index\":0,",
                "\"delta\":{\"type\":\"text_delta\",\"text\":\" reply\"}}\n\n",
                "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
                "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",",
                "\"stop_sequence\":null},\"usage\":{\"output_tokens\":2}}\n\n",
                "data: {\"type\":\"message_stop\"}\n\n",
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        (format!("http://{address}"), captured)
    }

    #[tokio::test]
    async fn anthropic_stream_carries_x_api_key_header() {
        let (base_url, captured) = serve_anthropic_stream().await;

        let response = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            call_provider(
                "custom_anthropic",
                "claude-probe".to_string(),
                vec![message("system", "You are a probe."), message("user", "hi")],
                Some("probe-key".to_string()),
                Some(base_url),
                None,
            ),
        )
        .await
        .expect("call must finish")
        .expect("streaming call must succeed");

        assert_eq!(response.content, "Streamed reply");

        let headers = captured.lock().unwrap().clone();
        assert!(
            headers
                .to_ascii_lowercase()
                .contains("x-api-key: probe-key"),
            "x-api-key must ride the streamed request (gateways that only read x-api-key): {headers}"
        );
        assert!(
            !headers.to_ascii_lowercase().contains("authorization"),
            "the anthropic wire is x-api-key only; a Bearer header would mask gateway quirks: {headers}"
        );
        assert!(
            headers.contains("anthropic-version"),
            "rig's anthropic-version header must survive: {headers}"
        );
    }
}
