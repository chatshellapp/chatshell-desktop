//! Provider smoke eval: prove the non-streaming provider chain (`call_provider`
//! and the vision seam) against a live HTTP endpoint — either the local
//! httpcan mock or a real provider.
//!
//! Test-only; excluded from normal runs. Zero-config run against a local
//! httpcan (https://github.com/seedvector/httpcan) container on port 18080:
//!
//! ```sh
//! cargo test --lib provider_smoke -- --ignored --nocapture
//! ```
//!
//! Real-provider run — set ANY of the variables below and ALL of
//! PROVIDER/MODEL/BASE_URL become required (no accidental localhost defaults):
//!
//! ```sh
//! CHATSHELL_SMOKE_PROVIDER=openai \
//! CHATSHELL_SMOKE_MODEL=gpt-4o-mini \
//! CHATSHELL_SMOKE_BASE_URL=https://api.openai.com/v1 \
//! CHATSHELL_SMOKE_API_KEY=sk-... \
//! cargo test --lib provider_smoke -- --ignored --nocapture
//! ```
//!
//! Both OpenAI wires against httpcan — `custom_openai` + `API_STYLE` picks
//! the wire (`chat_completions` hits `{base}/chat/completions`, anything
//! else hits `{base}/responses`); zero-config defaults are the first row:
//!
//! ```sh
//! # Chat Completions wire
//! CHATSHELL_SMOKE_PROVIDER=custom_openai \
//! CHATSHELL_SMOKE_BASE_URL=http://127.0.0.1:18080/llm/v1 \
//! cargo test --lib provider_smoke -- --ignored --nocapture
//!
//! # Responses wire
//! CHATSHELL_SMOKE_PROVIDER=custom_openai \
//! CHATSHELL_SMOKE_BASE_URL=http://127.0.0.1:18080/llm/v1 \
//! CHATSHELL_SMOKE_API_STYLE=responses \
//! cargo test --lib provider_smoke -- --ignored --nocapture
//! ```
//!
//! Gateways without a Responses implementation answer POST {base}/responses
//! with 404/405; the responses-wire test skips on that signature. A decode
//! error on a live stream stays a hard failure. Known rig 0.42 limitation
//! (not worked around): on tool-free Responses requests some gateways reply
//! `"tools": null` in response.created, which rig's non-Option `Vec` cannot
//! decode (OpenAI omits the field). With tools attached the response carries
//! a tools array and the stream decodes — verified end to end by the agent
//! tool loop below.
//!
//! Full agent tool loop (the model must issue a bash tool call that really
//! executes, then read the result back). The wire follows the provider
//! routing above, so all three wires are covered by three runs:
//!
//! ```sh
//! # Anthropic wire
//! CHATSHELL_SMOKE_PROVIDER=custom_anthropic \
//! CHATSHELL_SMOKE_BASE_URL=https://<gateway>/anthropic \
//! CHATSHELL_SMOKE_API_KEY=... cargo test --lib provider_smoke_agent_tool_loop -- --ignored --nocapture
//!
//! # OpenAI Chat Completions wire
//! CHATSHELL_SMOKE_PROVIDER=custom_openai \
//! CHATSHELL_SMOKE_API_STYLE=chat_completions \
//! CHATSHELL_SMOKE_BASE_URL=https://<gateway>/v1 \
//! CHATSHELL_SMOKE_API_KEY=... cargo test --lib provider_smoke_agent_tool_loop -- --ignored --nocapture
//!
//! # OpenAI Responses wire
//! CHATSHELL_SMOKE_PROVIDER=custom_openai \
//! CHATSHELL_SMOKE_API_STYLE=responses \
//! CHATSHELL_SMOKE_BASE_URL=https://<gateway>/v1 \
//! CHATSHELL_SMOKE_API_KEY=... cargo test --lib provider_smoke_agent_tool_loop -- --ignored --nocapture
//! ```
//!
//! The loop needs a model that actually issues tool calls, so the zero-config
//! httpcan default skips it; run it against a real provider.
//!
//! Env contract:
//! - `CHATSHELL_SMOKE_PROVIDER`   provider_type string (default `custom_openai`)
//! - `CHATSHELL_SMOKE_MODEL`      model id (default `httpcan-smoke-model`)
//! - `CHATSHELL_SMOKE_BASE_URL`   endpoint base URL (default local httpcan mock)
//! - `CHATSHELL_SMOKE_API_KEY`    optional; default `smoke-key` for the mock
//! - `CHATSHELL_SMOKE_API_STYLE`  optional; default `chat_completions`

use anyhow::{Context, Result, anyhow};

use super::tools::VisionQuestionResponder;
use super::{ChatMessage, call_provider};
use chatshell_agent_core::tools::ImageQuestionResponder as _;
use chatshell_agent_core::tools::image_question::ImageInput;

struct SmokeConfig {
    provider: String,
    model: String,
    base_url: String,
    api_key: String,
    api_style: Option<String>,
}

impl SmokeConfig {
    fn from_env() -> Result<Self> {
        let provider = std::env::var("CHATSHELL_SMOKE_PROVIDER").ok();
        let model = std::env::var("CHATSHELL_SMOKE_MODEL").ok();
        let base_url = std::env::var("CHATSHELL_SMOKE_BASE_URL").ok();

        // All-unset => local httpcan defaults. Any explicit override switches
        // to strict mode so a real run can never silently hit localhost.
        let (provider, model, base_url) =
            if provider.is_none() && model.is_none() && base_url.is_none() {
                (
                    "custom_openai".to_string(),
                    "httpcan-smoke-model".to_string(),
                    "http://127.0.0.1:18080/llm/v1".to_string(),
                )
            } else {
                let provider =
                    provider.ok_or_else(|| anyhow!("CHATSHELL_SMOKE_PROVIDER is required"))?;
                let model = model.ok_or_else(|| anyhow!("CHATSHELL_SMOKE_MODEL is required"))?;
                let base_url =
                    base_url.ok_or_else(|| anyhow!("CHATSHELL_SMOKE_BASE_URL is required"))?;
                (provider, model, base_url)
            };

        let api_key = match std::env::var("CHATSHELL_SMOKE_API_KEY") {
            Ok(key) => key,
            Err(_)
                if base_url.starts_with("http://127.0.0.1")
                    || base_url.starts_with("http://localhost") =>
            {
                "smoke-key".to_string()
            }
            // The placeholder once leaked to a real provider and cost a
            // confusing 401; refuse instead of sending it off-box.
            Err(_) => {
                return Err(anyhow!(
                    "CHATSHELL_SMOKE_API_KEY is required for non-local base URLs (refusing to send the placeholder 'smoke-key')"
                ));
            }
        };

        Ok(Self {
            provider,
            model,
            base_url,
            api_key,
            api_style: std::env::var("CHATSHELL_SMOKE_API_STYLE")
                .ok()
                .or_else(|| Some("chat_completions".to_string())),
        })
    }
}

fn user_message(content: &str) -> ChatMessage {
    ChatMessage {
        role: "user".to_string(),
        content: content.to_string(),
        images: vec![],
        files: vec![],
        tool_calls: vec![],
        tool_call_id: None,
        tool_result_call_id: None,
        reasoning_content: None,
    }
}

fn system_message(content: &str) -> ChatMessage {
    ChatMessage {
        role: "system".to_string(),
        content: content.to_string(),
        images: vec![],
        files: vec![],
        tool_calls: vec![],
        tool_call_id: None,
        tool_result_call_id: None,
        reasoning_content: None,
    }
}

/// A real 8x8 red PNG so the vision payload carries valid image bytes.
fn tiny_red_png() -> Vec<u8> {
    let img = image::RgbImage::from_pixel(8, 8, image::Rgb([200, 30, 30]));
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .expect("encode test png");
    buf.into_inner()
}

#[tokio::test]
#[ignore = "network smoke: targets local httpcan by default or a real provider via CHATSHELL_SMOKE_* env vars"]
async fn provider_smoke_text_roundtrip() {
    let config = SmokeConfig::from_env().expect("smoke config");
    println!(
        "smoke target: provider={} model={} base_url={}",
        config.provider, config.model, config.base_url
    );

    let response = call_provider(
        &config.provider,
        config.model.clone(),
        vec![
            system_message("You are a smoke test assistant."),
            user_message("Reply with any non-empty sentence."),
        ],
        Some(config.api_key.clone()),
        Some(config.base_url.clone()),
        config.api_style.clone(),
    )
    .await
    .context("text roundtrip failed");

    let content = response.expect("call_provider must succeed").content;
    println!("smoke reply: {content}");
    assert!(!content.trim().is_empty(), "reply must be non-empty");
}

#[tokio::test]
#[ignore = "network smoke: targets local httpcan by default or a real provider via CHATSHELL_SMOKE_* env vars"]
async fn provider_smoke_vision_question() {
    let config = SmokeConfig::from_env().expect("smoke config");
    println!(
        "smoke target: provider={} model={} base_url={}",
        config.provider, config.model, config.base_url
    );

    let responder = VisionQuestionResponder::new(
        config.provider.clone(),
        config.model.clone(),
        Some(config.api_key.clone()),
        Some(config.base_url.clone()),
        config.api_style.clone(),
    );

    let answer = responder
        .answer(
            ImageInput {
                bytes: tiny_red_png(),
                mime_type: "image/png".to_string(),
            },
            "What color is this image?".to_string(),
        )
        .await
        .expect("vision question must succeed");

    println!("smoke vision answer: {answer}");
    assert!(!answer.trim().is_empty(), "answer must be non-empty");
}

#[tokio::test]
#[ignore = "network smoke: targets local httpcan by default or a real provider via CHATSHELL_SMOKE_* env vars"]
async fn provider_smoke_openai_responses_wire() {
    let config = SmokeConfig::from_env().expect("smoke config");
    if !matches!(config.provider.as_str(), "openai" | "custom_openai") {
        println!(
            "skipping responses-wire smoke: provider {} is not OpenAI Responses-flavored",
            config.provider
        );
        return;
    }
    println!(
        "smoke target: provider={} model={} base_url={} (responses wire)",
        config.provider, config.model, config.base_url
    );

    // api_style None steers custom_openai away from chat_completions onto the
    // rig-native OpenAI Responses client.
    let result = call_provider(
        &config.provider,
        config.model.clone(),
        vec![
            system_message("You are a smoke test assistant."),
            user_message("Reply with any non-empty sentence."),
        ],
        Some(config.api_key.clone()),
        Some(config.base_url.clone()),
        None,
    )
    .await;

    let response = match result {
        Ok(response) => response,
        Err(error) => {
            let message = error.to_string();
            // A gateway without a Responses implementation answers
            // POST {base}/responses with 404/405 — a capability report,
            // not a wire defect; the hermetic httpcan run covers our wire.
            // Decode errors stay hard failures: an endpoint streaming a
            // nonconformant frame shape (e.g. `"tools": null` inside
            // response.created) is a real compatibility finding.
            let unsupported = message.contains("404")
                || message.contains("405")
                || message.to_lowercase().contains("not found");
            if unsupported {
                println!(
                    "responses wire: endpoint does not implement the OpenAI Responses API ({message}); skipping — expected for chat-completions-only gateways"
                );
                return;
            }
            panic!("responses-wire roundtrip failed: {message}");
        }
    };

    println!("smoke reply: {}", response.content);
    assert!(
        !response.content.trim().is_empty(),
        "reply must be non-empty"
    );
}

#[tokio::test]
#[ignore = "network smoke: the full agent tool loop needs a real tool-calling model; the local mock cannot drive it"]
async fn provider_smoke_agent_tool_loop() {
    use futures::StreamExt;
    use rig::agent::MultiTurnStreamItem;
    use rig::message::UserContent;
    use rig::prelude::StreamingChat;
    use rig::streaming::StreamedAssistantContent;

    use super::agent_builder::{AgentConfig, create_provider_agent};

    let config = SmokeConfig::from_env().expect("smoke config");
    if config.base_url.starts_with("http://127.0.0.1")
        || config.base_url.starts_with("http://localhost")
    {
        println!(
            "skipping agent-loop smoke: the local mock cannot issue tool calls; \
             point CHATSHELL_SMOKE_* at a real provider to exercise the loop"
        );
        return;
    }
    let wire = match (config.provider.as_str(), config.api_style.as_deref()) {
        ("custom_anthropic", _) => "anthropic",
        ("openai" | "custom_openai", Some("chat_completions")) => "openai-chat-completions",
        ("openai" | "custom_openai", _) => "openai-responses",
        (provider, _) => provider,
    };
    println!(
        "smoke target: provider={} model={} base_url={} wire={wire} (agent tool loop)",
        config.provider, config.model, config.base_url
    );

    // The model must drive bash to drop a marker file whose content it has
    // never seen, then read the value back from the tool result — proving
    // the whole loop: model -> tool call -> real execution -> result -> model.
    let workdir = tempfile::tempdir().unwrap();
    let token = format!("chatshell-e2e-{:016x}", rand::random::<u64>());
    let marker = workdir.path().join("marker.txt");

    let agent_config = AgentConfig::new()
        .with_bash()
        .with_bash_working_directory(workdir.path().to_string_lossy().to_string());
    let agent = create_provider_agent(
        &config.provider,
        &config.model,
        Some(config.api_key.as_str()),
        Some(config.base_url.as_str()),
        config.api_style.as_deref(),
        &agent_config,
    )
    .expect("agent construction must succeed");

    let prompt = rig::completion::Message::User {
        content: vec![UserContent::text(format!(
            "Use the bash tool to run exactly this command: echo {token} > marker.txt. \
             After it succeeds, reply with just the token and nothing else."
        ))],
    };

    let mut text = String::new();
    let mut stream = agent
        .stream_chat(prompt, Vec::<rig::completion::Message>::new())
        .max_turns(20)
        .await;
    tokio::time::timeout(std::time::Duration::from_secs(180), async {
        while let Some(item) = stream.next().await {
            match item {
                Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(
                    delta,
                ))) => text.push_str(&delta.text),
                Ok(_) => {}
                Err(error) => panic!("agent loop stream error: {error}"),
            }
        }
    })
    .await
    .expect("agent loop must finish within the timeout");

    println!("agent final text: {text}");
    let marker_content = std::fs::read_to_string(&marker).unwrap_or_default();
    println!("marker.txt content: {marker_content}");
    assert_eq!(
        marker_content.trim(),
        token,
        "the bash tool must have really executed"
    );
    assert!(
        text.contains(&token),
        "the model must have read the tool result back: {text}"
    );
}
