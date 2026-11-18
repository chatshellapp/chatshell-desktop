//! Desktop question dialog for the `ask_user` tool.
//!
//! The shared core owns the contract (schema, validation, result text);
//! this broker only round-trips a validated request to the frontend:
//! `ask-user-requested` out, `resolve_ask_user` back, and
//! `ask-user-resolved` when a request closes without an answer (the turn
//! was stopped, or the tool future was dropped). Same pattern as the MCP
//! elicitation broker, but a separate path: these questions come from the
//! model, not from a server.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chatshell_agent_core::tools::{AskUserAnswer, AskUserOutcome, AskUserPrompter, AskUserRequest};
use futures::future::BoxFuture;
use serde_json::{Value, json};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

/// Frontend event: the model asks the user questions.
pub const ASK_USER_REQUESTED_EVENT: &str = "ask-user-requested";
/// Frontend event: a pending request closed without an answer — the
/// dialog should dismiss.
pub const ASK_USER_RESOLVED_EVENT: &str = "ask-user-resolved";

/// Event emitter; abstracted so tests can capture payloads.
pub type AskUserEmitter = Arc<dyn Fn(&str, Value) + Send + Sync>;

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<AskUserOutcome>>>>;

/// App-wide registry of open `ask_user` requests.
pub struct AskUserBroker {
    pending: Pending,
    emitter: AskUserEmitter,
}

impl AskUserBroker {
    pub fn new(emitter: AskUserEmitter) -> Arc<Self> {
        Arc::new(Self {
            pending: Arc::default(),
            emitter,
        })
    }

    /// Deliver the user's response. False when the request is unknown or
    /// already closed.
    pub fn answer(&self, request_id: &str, outcome: AskUserOutcome) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some(sender) => sender.send(outcome).is_ok(),
            None => false,
        }
    }

    /// Number of open requests (tests / observability).
    pub fn pending_count(&self) -> usize {
        self.pending.lock().unwrap().len()
    }

    /// The prompter for one turn: requests carry the conversation id and
    /// close as cancelled when `cancel` fires (the user stopped the turn).
    pub fn for_turn(
        self: &Arc<Self>,
        conversation_id: String,
        cancel: CancellationToken,
    ) -> Arc<dyn AskUserPrompter> {
        Arc::new(TurnAskUser {
            broker: self.clone(),
            conversation_id,
            cancel,
        })
    }
}

/// Parse a frontend response: `submit` and `discuss` carry answers,
/// `decline` does not.
pub fn parse_response(action: &str, answers: Vec<AskUserAnswer>) -> Option<AskUserOutcome> {
    match action {
        "submit" => Some(AskUserOutcome::Answered(answers)),
        "discuss" => Some(AskUserOutcome::Discuss(answers)),
        "decline" => Some(AskUserOutcome::Declined),
        _ => None,
    }
}

/// Removes the pending entry (and tells the frontend) if the request ends
/// without an answer.
struct CloseOnDrop {
    pending: Pending,
    emitter: AskUserEmitter,
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
                ASK_USER_RESOLVED_EVENT,
                json!({ "request_id": self.request_id }),
            );
        }
    }
}

struct TurnAskUser {
    broker: Arc<AskUserBroker>,
    conversation_id: String,
    cancel: CancellationToken,
}

impl AskUserPrompter for TurnAskUser {
    fn prompt(&self, request: AskUserRequest) -> BoxFuture<'static, AskUserOutcome> {
        let request_id = uuid::Uuid::now_v7().to_string();
        let (sender, receiver) = oneshot::channel();
        self.broker
            .pending
            .lock()
            .unwrap()
            .insert(request_id.clone(), sender);
        (self.broker.emitter)(
            ASK_USER_REQUESTED_EVENT,
            json!({
                "request_id": request_id,
                "conversation_id": self.conversation_id,
                "questions": request.questions,
            }),
        );
        let guard = CloseOnDrop {
            pending: self.broker.pending.clone(),
            emitter: self.broker.emitter.clone(),
            request_id,
        };
        let cancel = self.cancel.clone();
        Box::pin(async move {
            let _guard = guard;
            tokio::select! {
                outcome = receiver => outcome.unwrap_or(AskUserOutcome::Cancelled),
                _ = cancel.cancelled() => AskUserOutcome::Cancelled,
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chatshell_agent_core::tools::ask_user::parse_request;

    type Capture = Arc<Mutex<Vec<(String, Value)>>>;

    fn broker() -> (Arc<AskUserBroker>, Capture) {
        let captured: Capture = Arc::default();
        let sink = captured.clone();
        let broker = AskUserBroker::new(Arc::new(move |event: &str, payload: Value| {
            sink.lock().unwrap().push((event.to_string(), payload));
        }));
        (broker, captured)
    }

    fn request() -> AskUserRequest {
        parse_request(&json!({ "questions": [{
            "id": "scope",
            "question": "Which scope?",
            "options": [{ "label": "File" }, { "label": "Repo", "recommended": true }]
        }]}))
        .unwrap()
    }

    #[tokio::test]
    async fn answer_reaches_the_waiting_request() {
        let (broker, captured) = broker();
        let prompter = broker.for_turn("conv-1".into(), CancellationToken::new());
        let ask = prompter.prompt(request());

        let (event, payload) = captured.lock().unwrap()[0].clone();
        assert_eq!(event, ASK_USER_REQUESTED_EVENT);
        assert_eq!(payload["conversation_id"], "conv-1");
        assert_eq!(payload["questions"][0]["options"][0]["label"], "Repo");
        assert_eq!(payload["questions"][0]["options"][0]["id"], "o1");

        let id = payload["request_id"].as_str().unwrap().to_string();
        let answers = vec![AskUserAnswer {
            question_id: "scope".into(),
            selected: vec!["o1".into()],
            text: None,
        }];
        assert!(broker.answer(&id, AskUserOutcome::Answered(answers.clone())));
        assert_eq!(ask.await, AskUserOutcome::Answered(answers));
        assert_eq!(broker.pending_count(), 0);
        assert!(!broker.answer(&id, AskUserOutcome::Declined), "only once");
        assert_eq!(
            captured.lock().unwrap().len(),
            1,
            "no resolved event after an answer"
        );
    }

    #[tokio::test]
    async fn stopping_the_turn_cancels_and_closes_the_dialog() {
        let (broker, captured) = broker();
        let cancel = CancellationToken::new();
        let ask = broker
            .for_turn("conv-1".into(), cancel.clone())
            .prompt(request());
        cancel.cancel();
        assert_eq!(ask.await, AskUserOutcome::Cancelled);
        assert_eq!(broker.pending_count(), 0);
        let events: Vec<String> = captured
            .lock()
            .unwrap()
            .iter()
            .map(|(e, _)| e.clone())
            .collect();
        assert_eq!(
            events,
            vec![ASK_USER_REQUESTED_EVENT, ASK_USER_RESOLVED_EVENT]
        );
    }

    #[tokio::test]
    async fn dropping_the_request_closes_the_dialog() {
        let (broker, captured) = broker();
        let ask = broker
            .for_turn("conv-1".into(), CancellationToken::new())
            .prompt(request());
        drop(ask);
        assert_eq!(broker.pending_count(), 0);
        assert_eq!(captured.lock().unwrap()[1].0, ASK_USER_RESOLVED_EVENT);
    }

    #[test]
    fn responses_parse_by_action() {
        assert_eq!(
            parse_response("decline", vec![]),
            Some(AskUserOutcome::Declined)
        );
        assert_eq!(
            parse_response("discuss", vec![]),
            Some(AskUserOutcome::Discuss(vec![]))
        );
        assert_eq!(
            parse_response("submit", vec![]),
            Some(AskUserOutcome::Answered(vec![]))
        );
        assert_eq!(parse_response("approve", vec![]), None);
    }
}
