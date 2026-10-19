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
//! Anthropic wire against httpcan:
//!
//! ```sh
//! CHATSHELL_SMOKE_PROVIDER=custom_anthropic \
//! CHATSHELL_SMOKE_MODEL=claude-smoke \
//! CHATSHELL_SMOKE_BASE_URL=http://127.0.0.1:18080/llm \
//! cargo test --lib provider_smoke -- --ignored --nocapture
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

        Ok(Self {
            provider,
            model,
            base_url,
            api_key: std::env::var("CHATSHELL_SMOKE_API_KEY")
                .unwrap_or_else(|_| "smoke-key".to_string()),
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
    let response = call_provider(
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
    .await
    .expect("responses-wire roundtrip must succeed");

    println!("smoke reply: {}", response.content);
    assert!(
        !response.content.trim().is_empty(),
        "reply must be non-empty"
    );
}
