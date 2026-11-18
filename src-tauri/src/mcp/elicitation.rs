//! Desktop dialog for MCP elicitation (`elicitation/create`, FR-12).
//!
//! The shared core decides the rules (never auto-approved, timeout and
//! server cancellation decline, answers validated and scanned); this
//! broker only round-trips the question to the frontend:
//! `mcp-elicitation-requested` out, `resolve_mcp_elicitation` back, and
//! `mcp-elicitation-resolved` when a dialog closes without an answer.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chatshell_agent_core::mcp::{
    McpElicitationAnswer, McpElicitationPrompter, McpElicitationRequest,
};
use futures::future::BoxFuture;
use serde_json::{Value, json};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

/// Frontend event: a server asks the user for input.
pub const ELICITATION_REQUESTED_EVENT: &str = "mcp-elicitation-requested";
/// Frontend event: a pending elicitation closed without an answer (timeout
/// or the server cancelled it) — the dialog should dismiss.
pub const ELICITATION_RESOLVED_EVENT: &str = "mcp-elicitation-resolved";

/// Event emitter; abstracted so tests can capture payloads.
pub type ElicitationEmitter = Arc<dyn Fn(&str, Value) + Send + Sync>;

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<McpElicitationAnswer>>>>;

pub struct ElicitationBroker {
    pending: Pending,
    emitter: ElicitationEmitter,
}

impl ElicitationBroker {
    pub fn new(emitter: ElicitationEmitter) -> Arc<Self> {
        Arc::new(Self {
            pending: Arc::default(),
            emitter,
        })
    }

    /// Deliver the user's answer. False when the request is unknown or
    /// already closed.
    pub fn answer(&self, request_id: &str, answer: McpElicitationAnswer) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some(sender) => sender.send(answer).is_ok(),
            None => false,
        }
    }

    /// Number of open requests (tests / observability).
    pub fn pending_count(&self) -> usize {
        self.pending.lock().unwrap().len()
    }
}

/// Parse a frontend answer: `accept` (with `content` for forms), `decline`,
/// or `cancel`.
pub fn parse_answer(action: &str, content: Option<Value>) -> Option<McpElicitationAnswer> {
    match action {
        "accept" => Some(McpElicitationAnswer::Accept(content.unwrap_or(Value::Null))),
        "decline" => Some(McpElicitationAnswer::Decline),
        "cancel" => Some(McpElicitationAnswer::Cancel),
        _ => None,
    }
}

/// Removes the pending entry (and tells the frontend) if the request ends
/// without an answer.
struct CloseOnDrop {
    pending: Pending,
    emitter: ElicitationEmitter,
    request_id: String,
}

impl Drop for CloseOnDrop {
    fn drop(&mut self) {
        if self
            .pending
            .lock()
            .unwrap()
            .remove(&self.request_id)
            .is_some()
        {
            (self.emitter)(
                ELICITATION_RESOLVED_EVENT,
                json!({ "request_id": self.request_id }),
            );
        }
    }
}

impl McpElicitationPrompter for ElicitationBroker {
    fn prompt(
        &self,
        server: String,
        request: McpElicitationRequest,
        dismissed: CancellationToken,
    ) -> BoxFuture<'static, McpElicitationAnswer> {
        let request_id = uuid::Uuid::now_v7().to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap()
            .insert(request_id.clone(), sender);
        let payload = match &request {
            McpElicitationRequest::Form { message, schema } => json!({
                "request_id": request_id,
                "server_name": server,
                "mode": "form",
                "message": message,
                "schema": schema,
            }),
            McpElicitationRequest::Url { message, url } => json!({
                "request_id": request_id,
                "server_name": server,
                "mode": "url",
                "message": message,
                "url": url,
            }),
        };
        (self.emitter)(ELICITATION_REQUESTED_EVENT, payload);
        let guard = CloseOnDrop {
            pending: self.pending.clone(),
            emitter: self.emitter.clone(),
            request_id,
        };
        Box::pin(async move {
            let _guard = guard;
            tokio::select! {
                answer = receiver => answer.unwrap_or(McpElicitationAnswer::Decline),
                _ = dismissed.cancelled() => McpElicitationAnswer::Decline,
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Capture = Arc<Mutex<Vec<(String, Value)>>>;

    fn broker() -> (Arc<ElicitationBroker>, Capture) {
        let captured: Capture = Arc::default();
        let sink = captured.clone();
        let broker = ElicitationBroker::new(Arc::new(move |event: &str, payload: Value| {
            sink.lock().unwrap().push((event.to_string(), payload));
        }));
        (broker, captured)
    }

    fn form() -> McpElicitationRequest {
        McpElicitationRequest::Form {
            message: "Your name?".into(),
            schema: json!({"type": "object", "properties": {"name": {"type": "string"}}}),
        }
    }

    #[tokio::test]
    async fn answer_reaches_the_waiting_request() {
        let (broker, captured) = broker();
        let ask = broker.prompt("srv".into(), form(), CancellationToken::new());
        let (event, payload) = captured.lock().unwrap()[0].clone();
        assert_eq!(event, ELICITATION_REQUESTED_EVENT);
        assert_eq!(payload["mode"], "form");
        assert_eq!(payload["server_name"], "srv");
        let id = payload["request_id"].as_str().unwrap().to_string();
        assert!(broker.answer(&id, McpElicitationAnswer::Accept(json!({"name": "Ada"}))));
        assert_eq!(
            ask.await,
            McpElicitationAnswer::Accept(json!({"name": "Ada"}))
        );
        assert_eq!(broker.pending_count(), 0);
        assert!(
            !broker.answer(&id, McpElicitationAnswer::Decline),
            "only once"
        );
    }

    #[tokio::test]
    async fn dismissal_declines_and_closes_the_dialog() {
        let (broker, captured) = broker();
        let dismissed = CancellationToken::new();
        let ask = broker.prompt(
            "srv".into(),
            McpElicitationRequest::Url {
                message: "Sign in".into(),
                url: "https://example.com".into(),
            },
            dismissed.clone(),
        );
        dismissed.cancel();
        assert_eq!(ask.await, McpElicitationAnswer::Decline);
        assert_eq!(broker.pending_count(), 0);
        let events: Vec<String> = captured
            .lock()
            .unwrap()
            .iter()
            .map(|(e, _)| e.clone())
            .collect();
        assert_eq!(
            events,
            [ELICITATION_REQUESTED_EVENT, ELICITATION_RESOLVED_EVENT]
        );
    }

    #[tokio::test]
    async fn dropping_the_request_closes_the_dialog() {
        let (broker, captured) = broker();
        drop(broker.prompt("srv".into(), form(), CancellationToken::new()));
        assert_eq!(broker.pending_count(), 0);
        assert_eq!(captured.lock().unwrap().len(), 2);
    }

    #[test]
    fn answers_parse() {
        assert_eq!(
            parse_answer("decline", None),
            Some(McpElicitationAnswer::Decline)
        );
        assert_eq!(
            parse_answer("cancel", None),
            Some(McpElicitationAnswer::Cancel)
        );
        assert_eq!(
            parse_answer("accept", Some(json!({"a": 1}))),
            Some(McpElicitationAnswer::Accept(json!({"a": 1})))
        );
        assert_eq!(parse_answer("approve", None), None);
    }
}
