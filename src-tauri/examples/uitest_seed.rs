//! UI-test seed database for the desktop conversation UI checks.
//!
//!   cargo run --example uitest_seed -- /tmp/chatshell-uitest/seed.db
//!
//! Built through the app's own `Database` API (migrations, message tree,
//! search index), never hand-written SQL. Providers point at the httpcan
//! LLM mock (`http://localhost:18080/llm/v1`, no key) and at a closed port
//! for failure checks. Deterministic content; no real data.

use chatshell_desktop_lib::db::Database;
use chatshell_desktop_lib::models::{
    CreateContentBlockRequest, CreateConversationParticipantRequest, CreateConversationRequest,
    CreateMessageRequest, CreateModelRequest, CreateProviderRequest, CreateThinkingStepRequest,
    CreateToolCallRequest,
};

const MOCK_BASE_URL: &str = "http://localhost:18080/llm/v1";
const DEAD_BASE_URL: &str = "http://127.0.0.1:9/v1";

/// Markdown paragraph long enough to give a row real height.
fn paragraph(topic: &str, n: usize) -> String {
    (1..=n)
        .map(|i| {
            format!(
                "Paragraph {i} about {topic}. This line exists to give the transcript \
                 a realistic height so scroll positions are meaningful in the UI tests."
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

struct Seeder {
    db: Database,
}

impl Seeder {
    async fn conversation(&self, title: &str, model_id: &str, model_name: &str) -> String {
        let conv = self
            .db
            .create_conversation(CreateConversationRequest {
                title: title.into(),
            })
            .await
            .expect("create conversation");
        self.db
            .add_conversation_participant(CreateConversationParticipantRequest {
                conversation_id: conv.id.clone(),
                participant_type: "model".into(),
                participant_id: Some(model_id.into()),
                display_name: Some(model_name.into()),
            })
            .await
            .expect("add participant");
        conv.id
    }

    async fn message(
        &self,
        conversation_id: &str,
        parent_id: Option<String>,
        sender_type: &str,
        sender_id: Option<&str>,
        content: &str,
    ) -> String {
        self.db
            .create_message(CreateMessageRequest {
                conversation_id: Some(conversation_id.into()),
                parent_id,
                sender_type: sender_type.into(),
                sender_id: sender_id.map(str::to_string),
                content: content.into(),
                tokens: None,
            })
            .await
            .expect("create message")
            .id
    }

    async fn user(&self, conversation_id: &str, content: &str) -> String {
        self.message(conversation_id, None, "user", None, content)
            .await
    }

    async fn reply(&self, conversation_id: &str, model_id: &str, content: &str) -> String {
        self.message(conversation_id, None, "model", Some(model_id), content)
            .await
    }

    async fn thinking(&self, message_id: &str, content: &str, order: i32) {
        self.db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: message_id.into(),
                content: content.into(),
                source: Some("llm".into()),
                display_order: Some(order),
            })
            .await
            .expect("create thinking step");
    }

    async fn tool(&self, message_id: &str, name: &str, status: &str, order: i32) {
        let (output, error) = match status {
            "success" => (Some(format!("{{\"result\": \"{name} ok\"}}")), None),
            "error" => (None, Some(format!("{name} failed: connection refused"))),
            _ => (None, None),
        };
        let req = CreateToolCallRequest {
            id: None,
            call_id: None,
            message_id: message_id.into(),
            tool_name: name.into(),
            tool_input: Some(format!("{{\"query\": \"{name}\"}}")),
            tool_output: output,
            status: Some(status.into()),
            error,
            duration_ms: None,
            display_order: Some(order),
            completed_at: None,
        };
        self.db
            .create_tool_call(req)
            .await
            .expect("create tool call");
    }

    async fn block(&self, message_id: &str, content: &str, order: i32) {
        self.db
            .create_content_block(CreateContentBlockRequest {
                message_id: message_id.into(),
                content: content.into(),
                display_order: order,
            })
            .await
            .expect("create content block");
    }
}

#[tokio::main]
async fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: uitest_seed <output.db>");
    let _ = std::fs::remove_file(&path);
    let db = Database::new(&path).await.expect("open database");
    db.seed_default_data().await.expect("seed defaults");
    let s = Seeder { db };

    // Providers: the httpcan mock (no key; lmstudio and gpustack are keyless
    // OpenAI-compatible routes) and a closed port for failure checks.
    let mock =
        s.db.create_provider(CreateProviderRequest {
            name: "httpcan mock".into(),
            provider_type: "lmstudio".into(),
            api_key: None,
            base_url: Some(MOCK_BASE_URL.into()),
            api_style: Some("chat_completions".into()),
            description: Some("UI tests".into()),
            is_enabled: Some(true),
        })
        .await
        .expect("create mock provider");
    let dead =
        s.db.create_provider(CreateProviderRequest {
            name: "dead endpoint".into(),
            // Built-in provider types have one fixed id each, so the second
            // keyless provider needs a different keyless type.
            provider_type: "gpustack".into(),
            api_key: None,
            base_url: Some(DEAD_BASE_URL.into()),
            api_style: Some("chat_completions".into()),
            description: Some("UI tests: connection refused".into()),
            is_enabled: Some(true),
        })
        .await
        .expect("create dead provider");
    let model =
        s.db.create_model(CreateModelRequest {
            name: "Mock GPT".into(),
            provider_id: mock.id.clone(),
            model_id: "gpt-5.5".into(),
            description: None,
            is_starred: Some(true),
        })
        .await
        .expect("create mock model");
    let dead_model =
        s.db.create_model(CreateModelRequest {
            name: "Dead GPT".into(),
            provider_id: dead.id.clone(),
            model_id: "gpt-5.5".into(),
            description: None,
            is_starred: Some(false),
        })
        .await
        .expect("create dead model");
    let m = model.id.as_str();

    // Failure: every send gets connection refused.
    let c = s
        .conversation("UI · Dead provider", &dead_model.id, "Dead GPT")
        .await;
    s.user(&c, "First question that was answered earlier.")
        .await;
    s.reply(&c, &dead_model.id, &paragraph("an earlier answer", 3))
        .await;

    // Long history: more than one 100-message page.
    let c = s.conversation("UI · Long history", m, "Mock GPT").await;
    for turn in 1..=65 {
        s.user(&c, &format!("Question {turn} in a long history."))
            .await;
        s.reply(&c, m, &paragraph(&format!("answer {turn}"), 2 + turn % 4))
            .await;
    }

    // Short tail: long turns, then a last user message with a short reply.
    let c = s.conversation("UI · Short tail", m, "Mock GPT").await;
    for turn in 1..=6 {
        s.user(&c, &format!("Long question {turn}.")).await;
        s.reply(&c, m, &paragraph(&format!("long answer {turn}"), 8))
            .await;
    }
    s.user(&c, "And the short one?").await;
    s.reply(&c, m, "```\nok: short reply, 155 characters or so, so the last turn is far shorter than the viewport and the floor has to do the work\n```")
        .await;

    // Branch: two sibling replies under one question; the first is active.
    let c = s.conversation("UI · Branch", m, "Mock GPT").await;
    s.user(&c, "Warm-up question.").await;
    s.reply(&c, m, &paragraph("the warm-up", 6)).await;
    let q = s.user(&c, "Question with two answers.").await;
    let first = s.reply(&c, m, &paragraph("the first variant", 3)).await;
    s.message(
        &c,
        Some(q.clone()),
        "model",
        Some(m),
        &paragraph("the second variant", 9),
    )
    .await;
    s.db.set_active_message(&c, &first)
        .await
        .expect("activate first variant");

    // Folds: one saved run per outcome.
    let c = s.conversation("UI · Folds", m, "Mock GPT").await;
    s.user(&c, "Run with thinking, two tools and text in between.")
        .await;
    let a = s.reply(&c, m, "Final answer after the tools.").await;
    s.thinking(&a, "Plan: search twice, then answer.", 0).await;
    s.block(&a, "Let me look this up.", 1).await;
    s.tool(&a, "web_search", "success", 2).await;
    s.block(&a, "One more check.", 3).await;
    s.tool(&a, "web_fetch", "success", 4).await;
    s.block(&a, &paragraph("the final answer", 2), 5).await;

    s.user(&c, "Run where one tool failed.").await;
    let a = s.reply(&c, m, "Answer despite a failed tool.").await;
    s.tool(&a, "web_search", "success", 0).await;
    s.tool(&a, "web_fetch", "error", 1).await;

    s.user(&c, "Run that was stopped.").await;
    let a = s.reply(&c, m, "Partial answer before the stop.").await;
    s.tool(&a, "web_search", "success", 0).await;
    s.tool(&a, "bash", "cancelled", 1).await;

    s.user(&c, "Run with thinking only.").await;
    let a = s.reply(&c, m, "Answer after thinking only.").await;
    s.thinking(&a, "Thinking without any tool call.", 0).await;

    s.user(&c, "Plain answer.").await;
    s.reply(&c, m, "A plain answer without a run.").await;

    // Send: a few turns to send into (newest, so it opens first).
    let c = s.conversation("UI · Send", m, "Mock GPT").await;
    for turn in 1..=3 {
        s.user(&c, &format!("Earlier question {turn}.")).await;
        s.reply(&c, m, &paragraph(&format!("earlier answer {turn}"), 5))
            .await;
    }

    println!("seed written to {path}");
}
