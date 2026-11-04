//! Desktop approval gate: a rig `AgentHook` that resolves every tool call
//! through the shared decision layer (`chatshell_agent_core::permission`)
//! and round-trips prompts to the frontend over Tauri events.
//!
//! Flow: `resolve()` returns Allow / Deny / Prompt. Prompt creates a
//! pending approval in the registry, emits `permission-requested`, and
//! awaits the user's `resolve_permission` command (or a timeout, or
//! stream-end cancellation). Denials become `ToolCallAction::Skip`, so
//! the model receives the reason as the tool result and can adapt.

use chatshell_agent_core::permission::{
    ForcedPrompt, GateDecision, GrantScope, PermissionMode, PermissionTier, SessionGrants,
    grant_scope, resolve,
};
use rig::agent::{AgentHook, HookContext, ToolCall, ToolCallAction};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;
use uuid::Uuid;

/// Frontend event: a tool call needs approval.
pub const PERMISSION_REQUESTED_EVENT: &str = "permission-requested";
/// Frontend event: a pending approval closed without user action
/// (timeout or stream end) — the dialog should dismiss.
pub const PERMISSION_RESOLVED_EVENT: &str = "permission-resolved";

/// How long the gate waits for the user before denying. Generous: the
/// turn keeps running, so an idle dialog must not kill a task.
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(600);

/// Denial reason fed back to the model when nobody answers an approval.
/// Phrased to discourage an immediate retry loop (each retry re-prompts).
const TIMEOUT_DENY_REASON: &str = "Approval request timed out (no user answer). \
Do not retry the same call; ask the user how to proceed.";

/// Frontend event emitter; abstracted so tests can capture payloads.
pub type PermissionEmitter = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// Per-conversation session grants, keyed by conversation id. Lives in
/// `AppState`, so grants survive across turns within a run of the app
/// and never touch disk or the sync snapshot.
pub type GrantStore = Arc<Mutex<HashMap<String, SessionGrants>>>;

/// Remove every session grant held for `conversation_id` (conversation
/// deleted). Returns whether any grants were held.
pub fn forget_conversation_grants(grants: &GrantStore, conversation_id: &str) -> bool {
    grants.lock().unwrap().remove(conversation_id).is_some()
}

/// The user's answer to an approval request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    AllowOnce,
    AllowSession,
    Deny,
}

impl ApprovalDecision {
    /// Parse the wire value sent by the frontend command.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "allow-once" => Some(ApprovalDecision::AllowOnce),
            "allow-session" => Some(ApprovalDecision::AllowSession),
            "deny" => Some(ApprovalDecision::Deny),
            _ => None,
        }
    }
}

struct PendingApproval {
    conversation_id: String,
    sender: oneshot::Sender<ApprovalDecision>,
}

/// Process-wide pending approvals, keyed by request id. The resolve
/// command and stream-end cancellation both act through this registry.
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, PendingApproval>>,
}

impl ApprovalRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn register(&self, conversation_id: &str) -> (String, oneshot::Receiver<ApprovalDecision>) {
        let (sender, receiver) = oneshot::channel();
        let request_id = Uuid::now_v7().to_string();
        self.pending.lock().unwrap().insert(
            request_id.clone(),
            PendingApproval {
                conversation_id: conversation_id.to_string(),
                sender,
            },
        );
        (request_id, receiver)
    }

    /// Deliver a decision. Returns false when the request is unknown or
    /// already answered (the hook future may have been dropped).
    pub fn resolve(&self, request_id: &str, decision: ApprovalDecision) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some(approval) => approval.sender.send(decision).is_ok(),
            None => false,
        }
    }

    /// Close every pending approval of a conversation by dropping its
    /// sender (stream ended or was aborted) — the awaiting gate sees a
    /// cancelled receiver rather than a user denial. Returns the closed
    /// request ids so the caller can emit `permission-resolved`.
    pub fn cancel_conversation(&self, conversation_id: &str) -> Vec<String> {
        let mut pending = self.pending.lock().unwrap();
        let ids: Vec<String> = pending
            .iter()
            .filter(|(_, approval)| approval.conversation_id == conversation_id)
            .map(|(request_id, _)| request_id.clone())
            .collect();
        for request_id in &ids {
            pending.remove(request_id);
        }
        ids
    }

    /// Number of pending approvals (test/observability helper).
    pub fn pending_count(&self) -> usize {
        self.pending.lock().unwrap().len()
    }
}

/// Outcome of gating one tool call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckOutcome {
    Allow,
    Deny(String),
}

/// One turn's gate: fixed mode, conversation-scoped grants, and the
/// shared registry + emitter.
pub struct PermissionGate {
    conversation_id: String,
    mode: PermissionMode,
    grants: GrantStore,
    registry: Arc<ApprovalRegistry>,
    emitter: PermissionEmitter,
    timeout: Duration,
}

impl PermissionGate {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        conversation_id: String,
        mode: PermissionMode,
        grants: GrantStore,
        registry: Arc<ApprovalRegistry>,
        emitter: PermissionEmitter,
    ) -> Arc<Self> {
        Arc::new(Self::with_timeout(
            conversation_id,
            mode,
            grants,
            registry,
            emitter,
            APPROVAL_TIMEOUT,
        ))
    }

    fn with_timeout(
        conversation_id: String,
        mode: PermissionMode,
        grants: GrantStore,
        registry: Arc<ApprovalRegistry>,
        emitter: PermissionEmitter,
        timeout: Duration,
    ) -> Self {
        Self {
            conversation_id,
            mode,
            grants,
            registry,
            emitter,
            timeout,
        }
    }

    fn grants_snapshot(&self) -> SessionGrants {
        self.grants
            .lock()
            .unwrap()
            .get(&self.conversation_id)
            .cloned()
            .unwrap_or_default()
    }

    fn store_grant(&self, scope: &GrantScope) {
        let mut store = self.grants.lock().unwrap();
        let grants = store.entry(self.conversation_id.clone()).or_default();
        match scope {
            GrantScope::BashCommands(bases) => {
                let refs: Vec<&str> = bases.iter().map(String::as_str).collect();
                grants.grant_bash_commands(&refs);
            }
            GrantScope::Tool(tool) => grants.grant_tool(tool),
            GrantScope::ServerTool { server, tool } => grants.grant_server_tool(server, tool),
        }
    }

    fn emit_resolved(&self, request_id: &str) {
        (self.emitter)(
            PERMISSION_RESOLVED_EVENT,
            json!({ "request_id": request_id }),
        );
    }

    /// Gate one tool call; Prompt decisions round-trip through the UI.
    pub async fn check(&self, tool_name: &str, args: &Value) -> CheckOutcome {
        let decision = resolve(self.mode, tool_name, args, &self.grants_snapshot());
        match decision {
            GateDecision::Allow => CheckOutcome::Allow,
            GateDecision::Deny { reason } => CheckOutcome::Deny(reason),
            GateDecision::Prompt { subject, forced } => {
                self.prompt(tool_name, args, subject, forced).await
            }
        }
    }

    async fn prompt(
        &self,
        tool_name: &str,
        args: &Value,
        subject: String,
        forced: Option<ForcedPrompt>,
    ) -> CheckOutcome {
        // Forced prompts are about this specific call: never offer a
        // session grant for them.
        let scope = match forced {
            Some(_) => None,
            None => grant_scope(tool_name, args),
        };
        let (request_id, receiver) = self.registry.register(&self.conversation_id);
        let tier = serde_json::to_value(PermissionTier::for_tool(tool_name))
            .unwrap_or(Value::String("exec".into()));
        (self.emitter)(
            PERMISSION_REQUESTED_EVENT,
            json!({
                "conversation_id": self.conversation_id,
                "request_id": request_id,
                "tool_name": tool_name,
                "subject": subject,
                "tier": tier,
                "warning": match &forced {
                    None => Value::Null,
                    Some(forced) => json!({ "kind": forced.kind, "detail": forced.detail }),
                },
                "grant": match &scope {
                    None => Value::Null,
                    Some(GrantScope::BashCommands(bases)) => {
                        json!({ "kind": "bash", "bases": bases })
                    }
                    Some(GrantScope::Tool(tool)) => json!({ "kind": "tool", "tool": tool }),
                    Some(GrantScope::ServerTool { server, tool }) => {
                        json!({ "kind": "server_tool", "server": server, "tool": tool })
                    }
                },
            }),
        );
        tracing::info!(
            "🛡️ [permission] Prompting for {} {} (request {})",
            tool_name,
            subject,
            request_id
        );

        match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(ApprovalDecision::AllowOnce)) => CheckOutcome::Allow,
            Ok(Ok(ApprovalDecision::AllowSession)) => {
                if let Some(scope) = scope {
                    self.store_grant(&scope);
                }
                CheckOutcome::Allow
            }
            Ok(Ok(ApprovalDecision::Deny)) => {
                CheckOutcome::Deny("User denied this tool call".to_string())
            }
            Ok(Err(_dropped)) => {
                // The awaiting hook future was dropped (stream cancelled).
                self.emit_resolved(&request_id);
                CheckOutcome::Deny("Approval request cancelled".to_string())
            }
            Err(_elapsed) => {
                self.registry.resolve(&request_id, ApprovalDecision::Deny);
                self.emit_resolved(&request_id);
                CheckOutcome::Deny(TIMEOUT_DENY_REASON.to_string())
            }
        }
    }
}

/// rig hook that routes every tool call through the gate. Attached in
/// `build_agent` when `AgentConfig.permission_gate` is set.
pub struct PermissionHook {
    gate: Arc<PermissionGate>,
}

impl PermissionHook {
    pub fn new(gate: Arc<PermissionGate>) -> Self {
        Self { gate }
    }
}

impl AgentHook for PermissionHook {
    fn on_tool_call(
        &self,
        _ctx: &HookContext,
        event: ToolCall<'_>,
    ) -> impl Future<Output = ToolCallAction> + Send {
        let gate = self.gate.clone();
        let tool_name = event.tool_name.to_string();
        let args: Value = serde_json::from_str(event.args).unwrap_or(Value::Null);
        async move {
            let outcome = gate.check(&tool_name, &args).await;
            if let CheckOutcome::Deny(reason) = &outcome {
                tracing::warn!("🛡️ [permission] Denied {}: {}", tool_name, reason);
            }
            to_action(outcome)
        }
    }
}

/// Map a gate outcome onto the rig hook action. `Skip` delivers the
/// denial verbatim to the model as the tool result.
fn to_action(outcome: CheckOutcome) -> ToolCallAction {
    match outcome {
        CheckOutcome::Allow => ToolCallAction::Run,
        CheckOutcome::Deny(reason) => ToolCallAction::Skip(format!("Permission denied: {reason}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captured (event, payload) pairs.
    type Capture = Arc<Mutex<Vec<(String, Value)>>>;

    fn test_emitter() -> (PermissionEmitter, Capture) {
        let captured: Capture = Arc::new(Mutex::new(Vec::new()));
        let sink = captured.clone();
        (
            Arc::new(move |event: &str, payload: Value| {
                sink.lock().unwrap().push((event.to_string(), payload));
            }),
            captured,
        )
    }

    struct Fixture {
        gate: Arc<PermissionGate>,
        registry: Arc<ApprovalRegistry>,
        grants: GrantStore,
        captured: Capture,
    }

    fn fixture(mode: PermissionMode) -> Fixture {
        let registry = ApprovalRegistry::new();
        let grants: GrantStore = Arc::new(Mutex::new(HashMap::new()));
        let (emitter, captured) = test_emitter();
        let gate = PermissionGate::new(
            "conv-1".to_string(),
            mode,
            grants.clone(),
            registry.clone(),
            emitter,
        );
        Fixture {
            gate,
            registry,
            grants,
            captured,
        }
    }

    fn bash(command: &str) -> Value {
        json!({ "command": command })
    }

    #[tokio::test]
    async fn yolo_allows_without_asking() {
        let f = fixture(PermissionMode::Yolo);
        assert_eq!(
            f.gate.check("bash", &bash("cargo test")).await,
            CheckOutcome::Allow
        );
        assert!(f.captured.lock().unwrap().is_empty());
        assert_eq!(f.registry.pending_count(), 0);
    }

    #[tokio::test]
    async fn blocklist_denies_without_prompt() {
        let f = fixture(PermissionMode::Ask);
        assert!(matches!(
            f.gate.check("bash", &bash("rm -rf /")).await,
            CheckOutcome::Deny(_)
        ));
        assert!(f.captured.lock().unwrap().is_empty());
    }

    /// Poll the captured events for the `expect_ordinal`-th permission
    /// request and answer it. Ordinal, not "latest": with concurrent
    /// prompts the latest captured event may still be a stale one whose
    /// registry entry is gone. Runs on the test side so `check` can block
    /// on its receiver without deadlocking.
    async fn answer_when_prompted(
        registry: &ApprovalRegistry,
        captured: &Capture,
        decision: ApprovalDecision,
        expect_ordinal: usize,
    ) {
        let request_id = loop {
            let found = captured
                .lock()
                .unwrap()
                .iter()
                .filter(|(event, _)| event.as_str() == PERMISSION_REQUESTED_EVENT)
                .nth(expect_ordinal)
                .map(|(_, payload)| payload["request_id"].as_str().unwrap().to_string());
            if let Some(id) = found {
                break id;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        };
        assert!(registry.resolve(&request_id, decision));
    }

    #[tokio::test]
    async fn ask_prompts_and_allow_once_does_not_cache() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move {
                gate.check("write", &json!({"path": "/tmp/a", "content": "x"}))
                    .await
            }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        // No session grant stored: the next write prompts again.
        assert!(matches!(
            resolve(
                PermissionMode::Ask,
                "write",
                &json!({"path": "/tmp/b"}),
                &f.grants
                    .lock()
                    .unwrap()
                    .get("conv-1")
                    .cloned()
                    .unwrap_or_default()
            ),
            GateDecision::Prompt { .. }
        ));
    }

    #[tokio::test]
    async fn allow_session_caches_grant() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("git status")).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowSession, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        // Grant cached: covered commands run without a new prompt.
        assert_eq!(
            f.gate.check("bash", &bash("git push")).await,
            CheckOutcome::Allow
        );
    }

    #[tokio::test]
    async fn allow_session_mcp_grants_only_that_server_tool() {
        let f = fixture(PermissionMode::Ask);
        let call = json!({"server": "srv", "tool": "fetch"});
        let task = tokio::spawn({
            let gate = f.gate.clone();
            let call = call.clone();
            async move { gate.check("mcp_tool_use", &call).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowSession, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        // Same server/tool runs without a new prompt.
        assert_eq!(
            f.gate.check("mcp_tool_use", &call).await,
            CheckOutcome::Allow
        );
        // A different tool on the same server prompts again.
        let other = json!({"server": "srv", "tool": "delete"});
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("mcp_tool_use", &other).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::Deny, 1).await;
        assert!(matches!(task.await.unwrap(), CheckOutcome::Deny(_)));
    }

    #[tokio::test]
    async fn requested_payload_carries_structured_grant() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("git status && git push")).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::Deny, 0).await;
        task.await.unwrap();
        let payload = f
            .captured
            .lock()
            .unwrap()
            .iter()
            .find(|(event, _)| event.as_str() == PERMISSION_REQUESTED_EVENT)
            .map(|(_, payload)| payload.clone())
            .expect("permission-requested emitted");
        assert_eq!(
            payload["grant"],
            json!({ "kind": "bash", "bases": ["git"] })
        );
    }

    #[tokio::test]
    async fn deny_answer_denies_with_reason() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("npm install")).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::Deny, 0).await;
        assert_eq!(
            task.await.unwrap(),
            CheckOutcome::Deny("User denied this tool call".to_string())
        );
    }

    #[tokio::test]
    async fn cancel_conversation_denies_pending() {
        let registry = ApprovalRegistry::new();
        let grants: GrantStore = Arc::new(Mutex::new(HashMap::new()));
        let (emitter, _captured) = test_emitter();
        let gate = PermissionGate::new(
            "conv-2".to_string(),
            PermissionMode::Ask,
            grants,
            registry.clone(),
            emitter,
        );
        let gate_task = tokio::spawn(async move { gate.check("bash", &bash("ls")).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let closed = registry.cancel_conversation("conv-2");
        assert_eq!(closed.len(), 1);
        assert_eq!(
            gate_task.await.unwrap(),
            CheckOutcome::Deny("Approval request cancelled".to_string())
        );
        assert_eq!(registry.pending_count(), 0);
    }

    #[tokio::test]
    async fn timeout_denies_and_emits_resolved() {
        let registry = ApprovalRegistry::new();
        let grants: GrantStore = Arc::new(Mutex::new(HashMap::new()));
        let (emitter, captured) = test_emitter();
        let gate = Arc::new(PermissionGate::with_timeout(
            "conv-3".to_string(),
            PermissionMode::Ask,
            grants,
            registry.clone(),
            emitter,
            Duration::from_millis(30),
        ));
        let outcome = gate.check("bash", &bash("ls")).await;
        assert_eq!(outcome, CheckOutcome::Deny(TIMEOUT_DENY_REASON.to_string()));
        assert_eq!(registry.pending_count(), 0);
        let events: Vec<String> = captured
            .lock()
            .unwrap()
            .iter()
            .map(|(event, _)| event.clone())
            .collect();
        assert!(events.contains(&PERMISSION_RESOLVED_EVENT.to_string()));
    }

    #[test]
    fn approval_decision_parses_wire_values() {
        assert_eq!(
            ApprovalDecision::parse("allow-once"),
            Some(ApprovalDecision::AllowOnce)
        );
        assert_eq!(
            ApprovalDecision::parse("allow-session"),
            Some(ApprovalDecision::AllowSession)
        );
        assert_eq!(
            ApprovalDecision::parse("deny"),
            Some(ApprovalDecision::Deny)
        );
        assert_eq!(ApprovalDecision::parse("bogus"), None);
    }

    #[test]
    fn to_action_maps_outcomes_onto_rig_actions() {
        assert_eq!(to_action(CheckOutcome::Allow), ToolCallAction::Run);
        assert!(
            matches!(to_action(CheckOutcome::Deny("nope".into())), ToolCallAction::Skip(reason) if reason == "Permission denied: nope")
        );
    }

    #[tokio::test]
    async fn forced_prompt_carries_warning_and_offers_no_grant() {
        let f = fixture(PermissionMode::Ask);
        f.grants
            .lock()
            .unwrap()
            .entry("conv-1".to_string())
            .or_default()
            .grant_bash_commands(&["curl"]);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("curl https://example.com")).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        let payload = f
            .captured
            .lock()
            .unwrap()
            .iter()
            .find(|(event, _)| event.as_str() == PERMISSION_REQUESTED_EVENT)
            .map(|(_, payload)| payload.clone())
            .expect("permission-requested emitted");
        assert_eq!(payload["warning"]["kind"], json!("network"));
        assert!(
            payload["warning"]["detail"]
                .as_str()
                .unwrap()
                .contains("example.com")
        );
        assert_eq!(payload["grant"], Value::Null);
    }

    #[tokio::test]
    async fn unforced_prompt_has_null_warning() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("cargo test")).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::Deny, 0).await;
        task.await.unwrap();
        let payload = f.captured.lock().unwrap()[0].1.clone();
        assert_eq!(payload["warning"], Value::Null);
        assert_eq!(
            payload["grant"],
            json!({ "kind": "bash", "bases": ["cargo"] })
        );
    }

    #[test]
    fn forget_conversation_grants_removes_only_that_conversation() {
        let grants: GrantStore = Arc::new(Mutex::new(HashMap::new()));
        {
            let mut store = grants.lock().unwrap();
            store.entry("a".into()).or_default().grant_tool("edit");
            store.entry("b".into()).or_default().grant_tool("edit");
        }
        assert!(forget_conversation_grants(&grants, "a"));
        assert!(!forget_conversation_grants(&grants, "a"));
        let store = grants.lock().unwrap();
        assert!(!store.contains_key("a"));
        assert!(store.contains_key("b"));
    }
}
