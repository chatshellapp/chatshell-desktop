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
    ForcedPrompt, ForcedPromptKind, GateContext, GateDecision, GrantScope, PermissionMode,
    PermissionTier, SessionGrants, grant_scope, remember_scope, resolve_in,
};
use chatshell_agent_core::permission_store::PersistentGrantStore;
use chatshell_agent_core::shell_env::BashEnvStore;
use chatshell_agent_core::tools::bash_sandbox::{
    EscalationDecision, EscalationKind, EscalationRequest, SandboxEscalator,
};
use rig::agent::{AgentHook, HookContext, ToolCall, ToolCallAction};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
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

/// The device's remembered-grant store, set once at startup (the app data
/// directory is only known inside Tauri's setup hook).
static PERSISTENT_GRANTS: OnceLock<PersistentGrantStore> = OnceLock::new();

/// The device's bash environment settings (passthrough variables).
static BASH_ENV: OnceLock<BashEnvStore> = OnceLock::new();

/// Point the device-local stores (remembered grants, bash environment)
/// at files in the app data directory. Called once from setup; later
/// calls are ignored. Neither file is part of the synced database.
pub fn init_device_stores(app_data_dir: &std::path::Path) {
    let _ = PERSISTENT_GRANTS.set(PersistentGrantStore::new(
        app_data_dir.join(chatshell_agent_core::permission_store::STORE_FILE_NAME),
    ));
    let _ = BASH_ENV.set(BashEnvStore::new(
        app_data_dir.join(chatshell_agent_core::shell_env::CONFIG_FILE_NAME),
    ));
}

/// The device's bash environment store, if initialized.
pub fn bash_env_store() -> Option<&'static BashEnvStore> {
    BASH_ENV.get()
}

/// Whether bash runs inside the OS sandbox under `mode`. Only `auto`
/// relies on the sandbox; `ask` prompts per command and `yolo` is the
/// explicit opt-in to unconfined execution.
pub fn sandbox_enabled_for(mode: PermissionMode) -> bool {
    mode == PermissionMode::Auto
}

/// Whether this machine has a sandbox backend (`auto` is offered only
/// where this is true).
pub fn sandbox_available() -> bool {
    chatshell_agent_core::sandbox::detect_backend().is_some()
}

/// The mode a turn actually runs in: `auto` without a sandbox backend
/// degrades to `ask` (a synced `auto` default on a machine without a
/// sandbox, e.g. Windows), never to unconfined execution.
pub fn effective_mode(mode: PermissionMode, sandbox_available: bool) -> PermissionMode {
    if mode == PermissionMode::Auto && !sandbox_available {
        PermissionMode::Ask
    } else {
        mode
    }
}

/// Facts about the turn the gate resolves against.
#[derive(Clone, Default)]
pub struct GateEnvironment {
    /// Conversation working directory.
    pub workspace: Option<PathBuf>,
    /// Bash runs inside the OS sandbox this turn.
    pub sandbox_available: bool,
    /// The conversation's "allow network this session" flag.
    pub network_flag: Option<Arc<AtomicBool>>,
}

/// The device's remembered-grant store, if initialized.
pub fn persistent_grants() -> Option<&'static PersistentGrantStore> {
    PERSISTENT_GRANTS.get()
}

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
    /// Sandbox escalation: run the command once outside the sandbox.
    RetryUnsandboxed,
    /// Sandbox escalation: allow network for the rest of the session.
    AllowNetworkSession,
}

impl ApprovalDecision {
    /// Parse the wire value sent by the frontend command.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "allow-once" => Some(ApprovalDecision::AllowOnce),
            "allow-session" => Some(ApprovalDecision::AllowSession),
            "deny" => Some(ApprovalDecision::Deny),
            "retry-unsandboxed" => Some(ApprovalDecision::RetryUnsandboxed),
            "allow-network-session" => Some(ApprovalDecision::AllowNetworkSession),
            _ => None,
        }
    }
}

/// A decision plus the "remember on this device" toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApprovalAnswer {
    pub decision: ApprovalDecision,
    pub remember: bool,
}

struct PendingApproval {
    conversation_id: String,
    sender: oneshot::Sender<ApprovalAnswer>,
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

    fn register(&self, conversation_id: &str) -> (String, oneshot::Receiver<ApprovalAnswer>) {
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
        self.answer(
            request_id,
            ApprovalAnswer {
                decision,
                remember: false,
            },
        )
    }

    /// Deliver a decision with the remember toggle.
    pub fn answer(&self, request_id: &str, answer: ApprovalAnswer) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some(approval) => approval.sender.send(answer).is_ok(),
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
    persistent: Option<PersistentGrantStore>,
    registry: Arc<ApprovalRegistry>,
    emitter: PermissionEmitter,
    timeout: Duration,
    environment: GateEnvironment,
}

impl PermissionGate {
    /// A gate with no workspace, sandbox, or network context (tests).
    #[cfg(test)]
    pub fn new(
        conversation_id: String,
        mode: PermissionMode,
        grants: GrantStore,
        registry: Arc<ApprovalRegistry>,
        emitter: PermissionEmitter,
    ) -> Arc<Self> {
        Self::with_environment(
            conversation_id,
            mode,
            grants,
            registry,
            emitter,
            GateEnvironment::default(),
        )
    }

    /// A gate that also knows the workspace, sandbox, and network state
    /// (needed by `auto`).
    pub fn with_environment(
        conversation_id: String,
        mode: PermissionMode,
        grants: GrantStore,
        registry: Arc<ApprovalRegistry>,
        emitter: PermissionEmitter,
        environment: GateEnvironment,
    ) -> Arc<Self> {
        let mut gate = Self::with_timeout(
            conversation_id,
            mode,
            grants,
            registry,
            emitter,
            APPROVAL_TIMEOUT,
        );
        gate.environment = environment;
        Arc::new(gate)
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
            persistent: persistent_grants().cloned(),
            registry,
            emitter,
            timeout,
            environment: GateEnvironment::default(),
        }
    }

    fn context(&self) -> GateContext {
        GateContext {
            workspace: self.environment.workspace.clone(),
            sandbox_available: self.environment.sandbox_available,
            network_allowed: self
                .environment
                .network_flag
                .as_ref()
                .is_some_and(|flag| flag.load(Ordering::SeqCst)),
        }
    }

    /// Session grants of this conversation merged with the device's
    /// remembered grants (read fresh on every check).
    fn grants_snapshot(&self) -> SessionGrants {
        let mut snapshot = self
            .grants
            .lock()
            .unwrap()
            .get(&self.conversation_id)
            .cloned()
            .unwrap_or_default();
        if let Some(store) = &self.persistent {
            match store.keys() {
                Ok(keys) => snapshot.extend_keys(keys),
                Err(err) => tracing::warn!("🛡️ [permission] Remembered grants unreadable: {err:#}"),
            }
        }
        snapshot
    }

    fn store_grant(&self, scope: &GrantScope) {
        let mut store = self.grants.lock().unwrap();
        store
            .entry(self.conversation_id.clone())
            .or_default()
            .grant_scope(scope);
    }

    async fn remember_grant(&self, tool_name: &str, scope: &GrantScope) {
        let Some(store) = self.persistent.clone() else {
            return;
        };
        let tool = tool_name.to_string();
        let keys = scope.keys();
        let result = tokio::task::spawn_blocking(move || store.record(&tool, &keys)).await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(err)) => tracing::warn!("🛡️ [permission] Could not remember grant: {err:#}"),
            Err(err) => tracing::warn!("🛡️ [permission] Remember task failed: {err}"),
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
        let decision = resolve_in(
            self.mode,
            &self.context(),
            tool_name,
            args,
            &self.grants_snapshot(),
        );
        match decision {
            GateDecision::Allow => CheckOutcome::Allow,
            GateDecision::Deny { reason } => CheckOutcome::Deny(reason),
            // Sandboxed auto: detected egress goes straight to the network
            // escalation card, so one network call yields one prompt.
            GateDecision::Prompt {
                subject,
                forced:
                    Some(ForcedPrompt {
                        kind: ForcedPromptKind::Network,
                        detail,
                    }),
            } if self.mode == PermissionMode::Auto && self.environment.sandbox_available => {
                self.network_before_execution(subject, detail).await
            }
            GateDecision::Prompt { subject, forced } => {
                self.prompt(tool_name, args, subject, forced).await
            }
        }
    }

    /// Pre-execution network escalation (auto + egress detection).
    async fn network_before_execution(&self, command: String, detail: String) -> CheckOutcome {
        let decision = self
            .escalation_card(
                EscalationRequest {
                    command,
                    kind: EscalationKind::Network,
                    detail,
                },
                false,
            )
            .await;
        match decision {
            EscalationDecision::AllowNetworkSession => {
                if let Some(flag) = &self.environment.network_flag {
                    flag.store(true, Ordering::SeqCst);
                }
                CheckOutcome::Allow
            }
            _ => CheckOutcome::Deny(
                "User did not allow network access for this command. Do not retry it; \
                 ask the user how to proceed."
                    .to_string(),
            ),
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
        // session grant or remembering for them.
        let (scope, remember) = match forced {
            Some(_) => (None, None),
            None => (
                grant_scope(tool_name, args),
                self.persistent
                    .as_ref()
                    .and_then(|_| remember_scope(tool_name, args)),
            ),
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
                "grant": scope.as_ref().map_or(Value::Null, scope_payload),
                "remember": remember.as_ref().map_or(Value::Null, scope_payload),
            }),
        );
        tracing::info!(
            "🛡️ [permission] Prompting for {} {} (request {})",
            tool_name,
            subject,
            request_id
        );

        let answer = tokio::time::timeout(self.timeout, receiver).await;
        if let Ok(Ok(ApprovalAnswer {
            decision: ApprovalDecision::AllowOnce | ApprovalDecision::AllowSession,
            remember: true,
        })) = &answer
            && let Some(remember) = &remember
        {
            self.remember_grant(tool_name, remember).await;
        }
        match answer.map(|received| received.map(|answer| answer.decision)) {
            Ok(Ok(ApprovalDecision::AllowOnce)) => CheckOutcome::Allow,
            Ok(Ok(ApprovalDecision::AllowSession)) => {
                if let Some(scope) = scope {
                    self.store_grant(&scope);
                }
                CheckOutcome::Allow
            }
            // Escalation answers never apply to a pre-execution prompt;
            // treat a mismatched answer as a denial (fail closed).
            Ok(Ok(
                ApprovalDecision::Deny
                | ApprovalDecision::RetryUnsandboxed
                | ApprovalDecision::AllowNetworkSession,
            )) => CheckOutcome::Deny("User denied this tool call".to_string()),
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

impl PermissionGate {
    /// Ask the user how to handle a command the OS sandbox blocked.
    /// Timeout, cancellation, and any non-escalation answer resolve to
    /// `Deny` (fail closed).
    pub async fn escalate(&self, request: EscalationRequest) -> EscalationDecision {
        self.escalation_card(request, true).await
    }

    /// Show an escalation card. `retry_option` offers "run once outside
    /// the sandbox" (only meaningful after a sandboxed run failed).
    async fn escalation_card(
        &self,
        request: EscalationRequest,
        retry_option: bool,
    ) -> EscalationDecision {
        let (request_id, receiver) = self.registry.register(&self.conversation_id);
        let network = request.kind == EscalationKind::Network;
        (self.emitter)(
            PERMISSION_REQUESTED_EVENT,
            json!({
                "conversation_id": self.conversation_id,
                "request_id": request_id,
                "tool_name": "bash",
                "subject": request.command,
                "tier": "exec",
                "warning": {
                    "kind": if network { "sandbox_network" } else { "sandbox" },
                    "detail": request.detail,
                },
                "grant": Value::Null,
                "remember": Value::Null,
                "escalation": { "network_option": network, "retry_option": retry_option },
            }),
        );
        tracing::info!(
            "🛡️ [permission] Sandbox escalation for {} (request {})",
            request.command,
            request_id
        );
        match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(answer)) => match answer.decision {
                ApprovalDecision::RetryUnsandboxed if retry_option => {
                    EscalationDecision::RetryUnsandboxed
                }
                ApprovalDecision::AllowNetworkSession if network => {
                    EscalationDecision::AllowNetworkSession
                }
                _ => EscalationDecision::Deny,
            },
            Ok(Err(_dropped)) => {
                self.emit_resolved(&request_id);
                EscalationDecision::Deny
            }
            Err(_elapsed) => {
                self.registry.resolve(&request_id, ApprovalDecision::Deny);
                self.emit_resolved(&request_id);
                EscalationDecision::Deny
            }
        }
    }
}

/// [`SandboxEscalator`] backed by the conversation's approval gate.
pub struct GateEscalator(pub Arc<PermissionGate>);

impl SandboxEscalator for GateEscalator {
    fn escalate<'a>(
        &'a self,
        request: EscalationRequest,
    ) -> Pin<Box<dyn Future<Output = EscalationDecision> + Send + 'a>> {
        Box::pin(self.0.escalate(request))
    }
}

/// Wire shape of a grant scope in `permission-requested`.
fn scope_payload(scope: &GrantScope) -> Value {
    match scope {
        GrantScope::BashCommands(bases) => json!({ "kind": "bash", "bases": bases }),
        GrantScope::Tool(tool) => json!({ "kind": "tool", "tool": tool }),
        GrantScope::ServerTool { server, tool } => {
            json!({ "kind": "server_tool", "server": server, "tool": tool })
        }
        GrantScope::WriteDirectory { tool, dir } => {
            json!({ "kind": "directory", "tool": tool, "dir": dir.display().to_string() })
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
    use chatshell_agent_core::permission::resolve;

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
        fixture_with_store(mode, None)
    }

    fn fixture_with_store(mode: PermissionMode, store: Option<PersistentGrantStore>) -> Fixture {
        let registry = ApprovalRegistry::new();
        let grants: GrantStore = Arc::new(Mutex::new(HashMap::new()));
        let (emitter, captured) = test_emitter();
        let mut gate = PermissionGate::with_timeout(
            "conv-1".to_string(),
            mode,
            grants.clone(),
            registry.clone(),
            emitter,
            APPROVAL_TIMEOUT,
        );
        gate.persistent = store;
        let gate = Arc::new(gate);
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
        // Grant cached: the same subcommand runs without a new prompt.
        assert_eq!(
            f.gate.check("bash", &bash("git status --short")).await,
            CheckOutcome::Allow
        );
        // Another subcommand of the same base prompts again.
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("git push --force")).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::Deny, 1).await;
        assert!(matches!(task.await.unwrap(), CheckOutcome::Deny(_)));
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
            json!({ "kind": "bash", "bases": ["git push", "git status"] })
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
        assert_eq!(
            ApprovalDecision::parse("retry-unsandboxed"),
            Some(ApprovalDecision::RetryUnsandboxed)
        );
        assert_eq!(
            ApprovalDecision::parse("allow-network-session"),
            Some(ApprovalDecision::AllowNetworkSession)
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
            json!({ "kind": "bash", "bases": ["cargo test"] })
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

    fn requested_payloads(captured: &Capture) -> Vec<Value> {
        captured
            .lock()
            .unwrap()
            .iter()
            .filter(|(event, _)| event.as_str() == PERMISSION_REQUESTED_EVENT)
            .map(|(_, payload)| payload.clone())
            .collect()
    }

    /// Answer the `ordinal`-th request with the remember toggle on.
    async fn answer_remembering(
        registry: &ApprovalRegistry,
        captured: &Capture,
        decision: ApprovalDecision,
        ordinal: usize,
    ) {
        let request_id = loop {
            if let Some(payload) = requested_payloads(captured).get(ordinal) {
                break payload["request_id"].as_str().unwrap().to_string();
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        };
        assert!(registry.answer(
            &request_id,
            ApprovalAnswer {
                decision,
                remember: true
            }
        ));
    }

    #[tokio::test]
    async fn remembered_grant_applies_in_a_new_conversation() {
        let dir = tempfile::tempdir().unwrap();
        let store = PersistentGrantStore::new(dir.path().join("permission_grants.db"));
        let f = fixture_with_store(PermissionMode::Ask, Some(store.clone()));
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("cargo test")).await }
        });
        answer_remembering(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        assert_eq!(
            requested_payloads(&f.captured)[0]["remember"],
            json!({ "kind": "bash", "bases": ["cargo test"] })
        );
        assert!(store.keys().unwrap().contains("bash:cargo test"));

        // A fresh gate (another conversation, empty session grants) on the
        // same device runs the remembered command without prompting.
        let other = fixture_with_store(PermissionMode::Ask, Some(store));
        assert_eq!(
            other.gate.check("bash", &bash("cargo test --lib")).await,
            CheckOutcome::Allow
        );
        assert!(requested_payloads(&other.captured).is_empty());
    }

    #[tokio::test]
    async fn forced_prompt_cannot_be_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let store = PersistentGrantStore::new(dir.path().join("permission_grants.db"));
        let f = fixture_with_store(PermissionMode::Ask, Some(store.clone()));
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("echo $(whoami)")).await }
        });
        answer_remembering(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        assert_eq!(requested_payloads(&f.captured)[0]["remember"], Value::Null);
        assert!(store.keys().unwrap().is_empty());
        assert!(!store.path().exists(), "no grant file should be created");
    }

    #[tokio::test]
    async fn denied_answer_never_remembers() {
        let dir = tempfile::tempdir().unwrap();
        let store = PersistentGrantStore::new(dir.path().join("permission_grants.db"));
        let f = fixture_with_store(PermissionMode::Ask, Some(store.clone()));
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("cargo test")).await }
        });
        answer_remembering(&f.registry, &f.captured, ApprovalDecision::Deny, 0).await;
        assert!(matches!(task.await.unwrap(), CheckOutcome::Deny(_)));
        assert!(store.keys().unwrap().is_empty());
    }

    #[tokio::test]
    async fn file_tool_remembers_the_directory_not_the_tool() {
        let dir = tempfile::tempdir().unwrap();
        let store = PersistentGrantStore::new(dir.path().join("permission_grants.db"));
        let work = dir.path().canonicalize().unwrap().join("work");
        std::fs::create_dir_all(&work).unwrap();
        let f = fixture_with_store(PermissionMode::Ask, Some(store.clone()));
        let target = work.join("a.txt");
        let task = tokio::spawn({
            let gate = f.gate.clone();
            let path = target.to_str().unwrap().to_string();
            async move {
                gate.check("write", &json!({ "path": path, "content": "x" }))
                    .await
            }
        });
        answer_remembering(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        assert_eq!(
            requested_payloads(&f.captured)[0]["remember"],
            json!({ "kind": "directory", "tool": "write", "dir": work.display().to_string() })
        );
        let other = fixture_with_store(PermissionMode::Ask, Some(store));
        let sibling = work.join("b.txt");
        assert_eq!(
            other
                .gate
                .check("edit", &json!({ "path": sibling.to_str().unwrap() }))
                .await,
            CheckOutcome::Allow
        );
    }

    fn escalation(kind: EscalationKind) -> EscalationRequest {
        EscalationRequest {
            command: "curl https://example.com".to_string(),
            kind,
            detail: "curl: (6) Could not resolve host: example.com".to_string(),
        }
    }

    #[tokio::test]
    async fn escalation_prompt_carries_options_and_maps_answers() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.escalate(escalation(EscalationKind::Network)).await }
        });
        answer_when_prompted(
            &f.registry,
            &f.captured,
            ApprovalDecision::AllowNetworkSession,
            0,
        )
        .await;
        assert_eq!(task.await.unwrap(), EscalationDecision::AllowNetworkSession);
        let payload = requested_payloads(&f.captured)[0].clone();
        assert_eq!(payload["warning"]["kind"], json!("sandbox_network"));
        assert_eq!(payload["escalation"]["network_option"], json!(true));
        assert_eq!(payload["grant"], Value::Null);
        assert_eq!(payload["remember"], Value::Null);
    }

    #[tokio::test]
    async fn network_answer_to_filesystem_escalation_is_denied() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.escalate(escalation(EscalationKind::Filesystem)).await }
        });
        answer_when_prompted(
            &f.registry,
            &f.captured,
            ApprovalDecision::AllowNetworkSession,
            0,
        )
        .await;
        assert_eq!(task.await.unwrap(), EscalationDecision::Deny);
        assert_eq!(
            requested_payloads(&f.captured)[0]["escalation"]["network_option"],
            json!(false)
        );
    }

    #[tokio::test]
    async fn escalation_answers_to_ordinary_prompts_deny() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("cargo test")).await }
        });
        answer_when_prompted(
            &f.registry,
            &f.captured,
            ApprovalDecision::RetryUnsandboxed,
            0,
        )
        .await;
        assert!(matches!(task.await.unwrap(), CheckOutcome::Deny(_)));
    }

    #[tokio::test]
    async fn cancelled_escalation_denies() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.escalate(escalation(EscalationKind::Filesystem)).await }
        });
        while requested_payloads(&f.captured).is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        f.registry.cancel_conversation("conv-1");
        assert_eq!(task.await.unwrap(), EscalationDecision::Deny);
    }

    #[test]
    fn only_auto_uses_the_sandbox() {
        assert!(sandbox_enabled_for(PermissionMode::Auto));
        assert!(!sandbox_enabled_for(PermissionMode::Ask));
        assert!(!sandbox_enabled_for(PermissionMode::Yolo));
    }

    #[test]
    fn auto_without_sandbox_runs_as_ask() {
        assert_eq!(
            effective_mode(PermissionMode::Auto, false),
            PermissionMode::Ask
        );
        assert_eq!(
            effective_mode(PermissionMode::Auto, true),
            PermissionMode::Auto
        );
        assert_eq!(
            effective_mode(PermissionMode::Yolo, false),
            PermissionMode::Yolo
        );
    }

    fn auto_fixture(network: Arc<AtomicBool>) -> Fixture {
        let registry = ApprovalRegistry::new();
        let grants: GrantStore = Arc::new(Mutex::new(HashMap::new()));
        let (emitter, captured) = test_emitter();
        let gate = PermissionGate::with_environment(
            "conv-1".to_string(),
            PermissionMode::Auto,
            grants.clone(),
            registry.clone(),
            emitter,
            GateEnvironment {
                workspace: Some(std::env::temp_dir()),
                sandbox_available: true,
                network_flag: Some(network),
            },
        );
        Fixture {
            gate,
            registry,
            grants,
            captured,
        }
    }

    #[tokio::test]
    async fn auto_egress_asks_once_with_the_network_card() {
        let network = Arc::new(AtomicBool::new(false));
        let f = auto_fixture(network.clone());
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("curl https://example.com")).await }
        });
        answer_when_prompted(
            &f.registry,
            &f.captured,
            ApprovalDecision::AllowNetworkSession,
            0,
        )
        .await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        let payload = requested_payloads(&f.captured)[0].clone();
        assert_eq!(payload["warning"]["kind"], json!("sandbox_network"));
        assert_eq!(payload["escalation"]["retry_option"], json!(false));
        assert!(network.load(Ordering::SeqCst));
        // Granted: the next network command runs without a prompt.
        assert_eq!(
            f.gate
                .check("bash", &bash("curl https://example.org"))
                .await,
            CheckOutcome::Allow
        );
        assert_eq!(requested_payloads(&f.captured).len(), 1);
    }

    #[tokio::test]
    async fn auto_runs_plain_commands_silently() {
        let f = auto_fixture(Arc::new(AtomicBool::new(false)));
        assert_eq!(
            f.gate.check("bash", &bash("cargo build")).await,
            CheckOutcome::Allow
        );
        assert!(requested_payloads(&f.captured).is_empty());
    }

    #[tokio::test]
    async fn retry_answer_is_rejected_on_a_pre_execution_card() {
        let network = Arc::new(AtomicBool::new(false));
        let f = auto_fixture(network.clone());
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash("curl https://example.com")).await }
        });
        answer_when_prompted(
            &f.registry,
            &f.captured,
            ApprovalDecision::RetryUnsandboxed,
            0,
        )
        .await;
        assert!(matches!(task.await.unwrap(), CheckOutcome::Deny(_)));
        assert!(!network.load(Ordering::SeqCst));
    }
}
