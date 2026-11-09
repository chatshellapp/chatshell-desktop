//! Desktop approval gate: a rig `AgentHook` that resolves every tool call
//! through the shared decision layer (`chatshell_agent_core::permission`)
//! and round-trips prompts to the frontend over Tauri events.
//!
//! Flow: `resolve()` returns Allow / Deny / Prompt / Classify. Prompt
//! creates a pending approval in the registry, emits
//! `permission-requested`, and awaits the user's `resolve_permission`
//! command (or a timeout, or stream-end cancellation). Classify goes to
//! the turn's auto-mode judge ([`JudgeSession`]: zero prompts, a marker
//! per judgment); `auto` without an eligible judge runs as `ask`, which
//! carries the jail wherever a backend exists (ADR 08). In jailed `ask`, a
//! bash prompt for an escape authorizes the same per-execution delta an
//! `auto` allow would. Denials become `ToolCallAction::Skip`, so the model
//! receives the reason as the tool result and can adapt.

use chatshell_agent_core::judgment::engine::{
    self as review_engine, JudgeModel, JudgeParams, Review, ReviewFailure, ReviewOutcome,
};
use chatshell_agent_core::judgment::log::{DecisionLog, DecisionRecord};
use chatshell_agent_core::judgment::ruleset::Posture;
use chatshell_agent_core::judgment::{
    JudgmentRequest, TranscriptBudget, TranscriptEntry, assemble,
    delta::{EscapePlan, escape_delta, execution_delta},
};
use chatshell_agent_core::net_policy;
use chatshell_agent_core::permission::{
    ForcedPrompt, ForcedPromptKind, GateContext, GateDecision, GrantScope, PermissionMode,
    PermissionTier, SessionGrants, grant_scope, remember_scope, resolve_in, subject_for,
};
use chatshell_agent_core::permission_store::PersistentGrantStore;
use chatshell_agent_core::shell_env::BashEnvStore;
use chatshell_agent_core::tools::bash_sandbox::{
    EscalationDecision, EscalationKind, EscalationRequest, ExecutionDelta, ExecutionDeltas,
    SandboxEscalator,
};
use rig::agent::{
    AgentHook, HookContext, ModelTurnAction, ModelTurnFinished, ToolCall, ToolCallAction,
    ToolResultAction, ToolResultEvent,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// Frontend event: a tool call needs approval.
pub const PERMISSION_REQUESTED_EVENT: &str = "permission-requested";
/// Frontend event: a pending approval closed without user action
/// (timeout or stream end) — the dialog should dismiss.
pub const PERMISSION_RESOLVED_EVENT: &str = "permission-resolved";

/// Frontend event: an auto-mode judgment (or a sandbox denial in judged
/// auto) for one tool call — the transcript marker.
pub const AUTO_REVIEW_EVENT: &str = "auto-review-decided";

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

/// Point the device-local stores (remembered grants, bash environment,
/// auto-review decision log) at files in the app data directory. Called once from setup; later
/// calls are ignored. Neither file is part of the synced database.
pub fn init_device_stores(app_data_dir: &std::path::Path) {
    let _ = PERSISTENT_GRANTS.set(PersistentGrantStore::new(
        app_data_dir.join(chatshell_agent_core::permission_store::STORE_FILE_NAME),
    ));
    let _ = BASH_ENV.set(BashEnvStore::new(
        app_data_dir.join(chatshell_agent_core::shell_env::CONFIG_FILE_NAME),
    ));
    super::auto_review::init_decision_log(app_data_dir);
}

/// The device's bash environment store, if initialized.
pub fn bash_env_store() -> Option<&'static BashEnvStore> {
    BASH_ENV.get()
}

/// Whether bash runs inside the OS sandbox under `mode` (where a backend
/// exists): `ask` and `auto` share one jail profile (ADR 08 INV-6); `yolo`
/// is the explicit opt-in to unconfined execution.
pub fn sandbox_enabled_for(mode: PermissionMode) -> bool {
    mode != PermissionMode::Yolo
}

/// The mode a turn runs in for a requested `mode` and the auto-mode
/// resolution: `auto` stays `auto` when judged and degrades to `ask`
/// otherwise — a prompting posture that carries the jail wherever a
/// backend exists, never unconfined execution.
pub fn effective_mode(
    mode: PermissionMode,
    resolution: review_engine::AutoResolution,
) -> PermissionMode {
    match (mode, resolution) {
        (PermissionMode::Auto, review_engine::AutoResolution::Ask) => PermissionMode::Ask,
        (mode, _) => mode,
    }
}

/// One turn's auto-mode judge (classifier `auto`).
pub struct JudgeSession {
    model: Arc<dyn JudgeModel>,
    /// Raised in place when a review needed a larger output bound.
    params: Mutex<JudgeParams>,
    /// The model's eligibility-cache key: a raised bound is kept there for
    /// later turns.
    budget_key: Mutex<Option<String>>,
    posture: Mutex<Posture>,
    /// User texts and tool inputs before this turn's tool calls, ending
    /// with the in-flight user message (extracted at the source).
    history: Vec<TranscriptEntry>,
    budget: TranscriptBudget,
    log: Option<DecisionLog>,
    /// Stream-end cancellation.
    cancel: CancellationToken,
    /// This turn's tool inputs, in the order the hook saw them.
    turn_inputs: Mutex<Vec<TranscriptEntry>>,
    /// Bash command -> its latest call: the tool call id and the full
    /// arguments. Sandbox denials arrive with the command only; the
    /// arguments (`workdir` included) are what run-anyway must match.
    bash_calls: Mutex<HashMap<String, BashCall>>,
    /// Reviews started when the model's turn finished, before its tool
    /// calls run one by one (see [`PermissionGate::prefetch_reviews`]).
    prefetched: Mutex<Vec<Prefetch>>,
}

/// A review started ahead of its tool call, with everything it was
/// started from. The call's gate uses it only if all of that is unchanged
/// when the call is decided; otherwise it reviews afresh.
struct Prefetch {
    tool_name: String,
    args: Value,
    request: JudgmentRequest,
    transcript: chatshell_agent_core::judgment::AssembledTranscript,
    posture: Posture,
    params: JudgeParams,
    task: tokio::task::JoinHandle<Review>,
}

impl Drop for JudgeSession {
    fn drop(&mut self) {
        // Reviews nobody will read: stop paying for them.
        for prefetch in self.prefetched.get_mut().unwrap().drain(..) {
            prefetch.task.abort();
        }
    }
}

impl JudgeSession {
    pub fn new(
        model: Arc<dyn JudgeModel>,
        params: JudgeParams,
        posture: Posture,
        history: Vec<TranscriptEntry>,
        log: Option<DecisionLog>,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        Arc::new(Self {
            model,
            params: Mutex::new(params),
            budget_key: Mutex::new(None),
            posture: Mutex::new(posture),
            history,
            budget: TranscriptBudget::default(),
            log,
            cancel,
            turn_inputs: Mutex::new(Vec::new()),
            bash_calls: Mutex::new(HashMap::new()),
            prefetched: Mutex::new(Vec::new()),
        })
    }

    /// Name the model's eligibility-cache entry, so a raised output bound
    /// outlives this turn.
    pub fn set_budget_key(&self, key: String) {
        *self.budget_key.lock().unwrap() = Some(key);
    }

    /// Keep a larger output bound a review needed, for this turn's later
    /// reviews and (through the cache) later turns.
    fn keep_budget(&self, max_tokens: u32) {
        let mut params = self.params.lock().unwrap();
        if max_tokens <= params.max_tokens {
            return;
        }
        params.max_tokens = max_tokens;
        if let Some(key) = self.budget_key.lock().unwrap().as_deref() {
            super::auto_review::raise_budget(key, max_tokens);
        }
    }

    /// Set the MCP servers the posture names (loaded after the gate).
    pub fn set_mcp_servers(&self, servers: Vec<String>) {
        self.posture.lock().unwrap().mcp_servers = servers;
    }

    fn transcript(&self) -> chatshell_agent_core::judgment::AssembledTranscript {
        self.transcript_with(&[])
    }

    /// The transcript once `ahead` (tool inputs not decided yet) have been
    /// decided: each call's input joins the transcript after its decision,
    /// whatever the outcome, so a later call in the same batch sees these.
    fn transcript_with(
        &self,
        ahead: &[TranscriptEntry],
    ) -> chatshell_agent_core::judgment::AssembledTranscript {
        let mut entries = self.history.clone();
        entries.extend(self.turn_inputs.lock().unwrap().iter().cloned());
        entries.extend(ahead.iter().cloned());
        assemble(&entries, self.budget)
    }

    /// The prefetched review of this call, if it was started from exactly
    /// the inputs a review now would use. A prefetch for the same call
    /// whose inputs changed (a session network grant, cwd drift, a raised
    /// output bound) is aborted, and the caller reviews afresh.
    fn take_prefetched(
        &self,
        tool_name: &str,
        args: &Value,
        current: Option<(
            &JudgmentRequest,
            &chatshell_agent_core::judgment::AssembledTranscript,
            &Posture,
            &JudgeParams,
        )>,
    ) -> Option<tokio::task::JoinHandle<Review>> {
        let mut prefetched = self.prefetched.lock().unwrap();
        let index = prefetched
            .iter()
            .position(|p| p.tool_name == tool_name && &p.args == args)?;
        let prefetch = prefetched.remove(index);
        let same = current.is_some_and(|(request, transcript, posture, params)| {
            &prefetch.request == request
                && &prefetch.transcript == transcript
                && &prefetch.posture == posture
                && &prefetch.params == params
        });
        if same {
            Some(prefetch.task)
        } else {
            prefetch.task.abort();
            None
        }
    }

    fn push_turn_input(&self, tool_name: &str, args: &Value) {
        self.turn_inputs
            .lock()
            .unwrap()
            .push(TranscriptEntry::ToolInput {
                tool: tool_name.to_string(),
                input: args.clone(),
            });
    }

    fn record(&self, record: DecisionRecord) {
        let Some(log) = self.log.clone() else {
            return;
        };
        tokio::task::spawn_blocking(move || {
            if let Err(err) = log.record(&record) {
                tracing::warn!("🛡️ [auto_review] Decision log write failed: {err:#}");
            }
        });
    }
}

/// The latest bash call of a command this turn.
#[derive(Clone)]
struct BashCall {
    tool_call_id: Option<String>,
    args: Value,
}

/// The `workdir` argument of a bash call.
fn bash_workdir(args: &Value) -> Option<&str> {
    args.get("workdir").and_then(Value::as_str)
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
    /// The conversation scratch directory (a jail writable root).
    pub scratch_dir: Option<PathBuf>,
    /// The auto-mode judge, when `auto` resolved to judged.
    pub judge: Option<Arc<JudgeSession>>,
    /// Per-execution jail deltas, shared with the bash tool: authorized by
    /// a judge's allow, a run-anyway, or (jailed `ask`) an approved escape
    /// card (ADR 08 SA-3).
    pub deltas: ExecutionDeltas,
    /// The bash shell has left its launch directory (shared with the bash
    /// tool; relative write targets are then unprovable).
    pub cwd_drifted: Option<Arc<AtomicBool>>,
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
            scratch_dir: self.environment.scratch_dir.clone(),
            cwd_drifted: self
                .environment
                .cwd_drifted
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

    async fn remember_grant(&self, tool_name: &str, scope: &GrantScope) -> bool {
        let Some(store) = self.persistent.clone() else {
            return false;
        };
        let tool = tool_name.to_string();
        let keys = scope.keys();
        let result = tokio::task::spawn_blocking(move || store.record(&tool, &keys)).await;
        match result {
            Ok(Ok(())) => true,
            Ok(Err(err)) => {
                tracing::warn!("🛡️ [permission] Could not remember grant: {err:#}");
                false
            }
            Err(err) => {
                tracing::warn!("🛡️ [permission] Remember task failed: {err}");
                false
            }
        }
    }

    fn emit_resolved(&self, request_id: &str) {
        (self.emitter)(
            PERMISSION_RESOLVED_EVENT,
            json!({ "request_id": request_id }),
        );
    }

    /// Gate one tool call; Prompt decisions round-trip through the UI.
    #[cfg(test)]
    pub async fn check(&self, tool_name: &str, args: &Value) -> CheckOutcome {
        self.check_call(None, tool_name, args).await
    }

    /// Gate one tool call with its id (markers attach to it), logging one
    /// INFO line for the decision.
    pub async fn check_call(
        &self,
        tool_call_id: Option<&str>,
        tool_name: &str,
        args: &Value,
    ) -> CheckOutcome {
        let (outcome, source) = self.decide(tool_call_id, tool_name, args).await;
        tracing::info!("{}", decision_line(tool_name, args, &outcome, &source));
        outcome
    }

    /// Gate one tool call: the outcome and where it came from.
    async fn decide(
        &self,
        tool_call_id: Option<&str>,
        tool_name: &str,
        args: &Value,
    ) -> (CheckOutcome, String) {
        let judge = self.environment.judge.clone();
        let command = (tool_name == "bash")
            .then(|| args.get("command").and_then(Value::as_str))
            .flatten();
        if let (Some(judge), Some(command)) = (&judge, command) {
            judge.bash_calls.lock().unwrap().insert(
                command.to_string(),
                BashCall {
                    tool_call_id: tool_call_id.map(str::to_string),
                    args: args.clone(),
                },
            );
        }
        let ctx = self.context();
        let decision = resolve_in(self.mode, &ctx, tool_name, args, &self.grants_snapshot());
        let (outcome, source) = match decision {
            GateDecision::Allow => {
                let mut source = allow_source(self.mode, &ctx, tool_name, args).to_string();
                // Run-anyway on a sandbox denial: the command runs once
                // outside the sandbox.
                if let (Some(_), Some(command)) = (&judge, command)
                    && let Some(action) =
                        super::auto_review::take_override(&self.conversation_id, tool_name, args)
                {
                    if action.unsandboxed {
                        self.environment.deltas.authorize(
                            command,
                            bash_workdir(args),
                            ExecutionDelta {
                                unsandboxed: true,
                                ..ExecutionDelta::default()
                            },
                        );
                    }
                    self.emit_marker(tool_call_id, tool_name, args, "override", None, None, false);
                    source = if action.unsandboxed {
                        "run anyway, once outside the sandbox".to_string()
                    } else {
                        "run anyway".to_string()
                    };
                }
                (CheckOutcome::Allow, source)
            }
            GateDecision::Deny { reason } => (CheckOutcome::Deny(reason), "policy".to_string()),
            GateDecision::Classify(request) => match &judge {
                Some(judge) => {
                    self.judged(judge, &ctx, tool_call_id, tool_name, args, *request)
                        .await
                }
                // Classify only occurs in judged `auto`, which always has a
                // judge; should that ever break, fail safe to a prompt.
                None => {
                    self.prompt(tool_name, args, request.subject, request.forced, None)
                        .await
                }
            },
            GateDecision::Prompt { subject, forced } => {
                self.ask_prompt(&ctx, tool_name, args, subject, forced)
                    .await
            }
        };
        if let Some(judge) = &judge {
            judge.push_turn_input(tool_name, args);
        }
        (outcome, source)
    }

    /// Start the reviews of a finished model turn's tool calls at once.
    ///
    /// rig runs a turn's tool calls one by one, and each would otherwise
    /// wait for the previous call's review and execution before its own
    /// review starts. A review reads no tool output — only the transcript
    /// (history plus the tool inputs decided so far) and the call's
    /// request — so every call's review inputs are known when the turn
    /// finishes. Each is started now; the call's gate uses it only if its
    /// inputs are unchanged when the call is decided
    /// ([`JudgeSession::take_prefetched`]). Markers, the decision log, and
    /// deltas still happen at decision time, in call order.
    pub fn prefetch_reviews(&self, calls: &[(String, Value)]) {
        let Some(judge) = self.environment.judge.clone() else {
            return;
        };
        let ctx = self.context();
        let grants = self.grants_snapshot();
        let posture = judge.posture.lock().unwrap().clone();
        let params = judge.params.lock().unwrap().clone();
        let mut ahead: Vec<TranscriptEntry> = Vec::new();
        let mut started = Vec::new();
        for (tool_name, args) in calls {
            if let GateDecision::Classify(request) =
                resolve_in(self.mode, &ctx, tool_name, args, &grants)
            {
                let transcript = judge.transcript_with(&ahead);
                let task = tokio::spawn(timed_review(
                    judge.model.clone(),
                    params.clone(),
                    posture.clone(),
                    transcript.clone(),
                    (*request).clone(),
                    judge.cancel.clone(),
                    self.timeout,
                    format!("{} {}", tool_name, log_subject(tool_name, args)),
                ));
                started.push(Prefetch {
                    tool_name: tool_name.clone(),
                    args: args.clone(),
                    request: *request,
                    transcript,
                    posture: posture.clone(),
                    params: params.clone(),
                    task,
                });
            }
            ahead.push(TranscriptEntry::ToolInput {
                tool: tool_name.clone(),
                input: args.clone(),
            });
        }
        let mut prefetched = judge.prefetched.lock().unwrap();
        // A new turn: whatever the last one left unused is stale.
        for stale in prefetched.drain(..) {
            stale.task.abort();
        }
        if !started.is_empty() {
            tracing::debug!(
                "🛡️ [auto_review] Started {} review(s) with the model turn",
                started.len()
            );
        }
        *prefetched = started;
    }

    /// Route a judgment request to the auto-mode judge.
    async fn judged(
        &self,
        judge: &JudgeSession,
        ctx: &GateContext,
        tool_call_id: Option<&str>,
        tool_name: &str,
        args: &Value,
        request: JudgmentRequest,
    ) -> (CheckOutcome, String) {
        let command = args.get("command").and_then(Value::as_str);
        // Run-anyway: a human override for this exact action executes it
        // once, with the deltas an allow would have produced. No grant.
        if let Some(action) =
            super::auto_review::take_override(&self.conversation_id, tool_name, args)
        {
            if let Some(command) = command {
                let delta = if action.unsandboxed {
                    Some(ExecutionDelta {
                        unsandboxed: true,
                        ..ExecutionDelta::default()
                    })
                } else {
                    execution_delta(&request, args, ctx)
                };
                if let Some(delta) = delta {
                    self.environment
                        .deltas
                        .authorize(command, bash_workdir(args), delta);
                }
            }
            judge.take_prefetched(tool_name, args, None);
            self.emit_marker(tool_call_id, tool_name, args, "override", None, None, false);
            return (CheckOutcome::Allow, "run anyway".to_string());
        }

        let transcript = judge.transcript();
        let posture = judge.posture.lock().unwrap().clone();
        let params = judge.params.lock().unwrap().clone();
        let prefetched = judge.take_prefetched(
            tool_name,
            args,
            Some((&request, &transcript, &posture, &params)),
        );
        let review = match prefetched {
            Some(task) => match task.await {
                Ok(review) => {
                    tracing::debug!(
                        "🛡️ [auto_review] Using the review started with the model turn for {} {}",
                        tool_name,
                        log_subject(tool_name, args)
                    );
                    Some(review)
                }
                Err(_aborted_or_panicked) => None,
            },
            None => None,
        };
        let review = match review {
            Some(review) => review,
            None => {
                timed_review(
                    judge.model.clone(),
                    params,
                    posture,
                    transcript,
                    request.clone(),
                    judge.cancel.clone(),
                    self.timeout,
                    format!("{} {}", tool_name, log_subject(tool_name, args)),
                )
                .await
            }
        };

        judge.keep_budget(review.max_tokens);
        let delta = match &review.outcome {
            ReviewOutcome::Allow { .. } => execution_delta(&request, args, ctx),
            _ => None,
        };
        if let (Some(delta), Some(command)) = (&delta, command) {
            self.environment
                .deltas
                .authorize(command, bash_workdir(args), delta.clone());
        }
        let record = DecisionRecord::from_review(
            &self.conversation_id,
            tool_call_id,
            &request,
            &review,
            delta.as_ref().map(ExecutionDelta::describe),
        );
        let decision_id = record.id.clone();
        judge.record(record);
        let suggest =
            super::auto_review::denial_counters().record(&self.conversation_id, &review.outcome);
        let timing = format!(
            "{:.1}s, {} attempt(s), {}",
            review.duration.as_secs_f64(),
            review.attempts,
            review.model
        );
        let source_of = |verdict: &chatshell_agent_core::judgment::verdict::Verdict| {
            format!(
                "auto-review: {} risk, {} authorization; {}",
                wire_name(&verdict.risk_level),
                wire_name(&verdict.user_authorization),
                timing
            )
        };
        if let ReviewOutcome::Failed { failure } = &review.outcome {
            tracing::warn!(
                "🛡️ [auto_review] Review failed for {} {}: {} ({})",
                tool_name,
                log_subject(tool_name, args),
                match failure {
                    ReviewFailure::Unavailable(_) => "unavailable",
                    ReviewFailure::Unparseable(_) => "unparseable",
                    ReviewFailure::Truncated(_) => "truncated",
                },
                timing
            );
        }

        let reason = review.outcome.model_reason();
        match &review.outcome {
            ReviewOutcome::Allow { verdict } => {
                self.emit_marker(
                    tool_call_id,
                    tool_name,
                    args,
                    "allowed",
                    Some(&decision_id),
                    Some((verdict.risk_level, verdict.rationale.as_str())),
                    false,
                );
                (CheckOutcome::Allow, source_of(verdict))
            }
            ReviewOutcome::Cancelled => (
                CheckOutcome::Deny("Auto-review was cancelled".to_string()),
                "auto-review cancelled".to_string(),
            ),
            ReviewOutcome::Block { verdict } => {
                self.remember_denial(&decision_id, tool_name, args, false);
                self.emit_marker(
                    tool_call_id,
                    tool_name,
                    args,
                    "denied",
                    Some(&decision_id),
                    Some((verdict.risk_level, verdict.rationale.as_str())),
                    suggest,
                );
                (
                    CheckOutcome::Deny(reason.unwrap_or_default()),
                    source_of(verdict),
                )
            }
            ReviewOutcome::Failed { .. } => {
                self.remember_denial(&decision_id, tool_name, args, false);
                self.emit_marker(
                    tool_call_id,
                    tool_name,
                    args,
                    "failed",
                    Some(&decision_id),
                    None,
                    suggest,
                );
                (
                    CheckOutcome::Deny(reason.unwrap_or_default()),
                    format!("auto-review failed; {timing}"),
                )
            }
        }
    }

    fn remember_denial(&self, decision_id: &str, tool_name: &str, args: &Value, unsandboxed: bool) {
        super::auto_review::remember_denial(
            decision_id,
            super::auto_review::PendingAction {
                conversation_id: self.conversation_id.clone(),
                tool_name: tool_name.to_string(),
                args: args.clone(),
                subject: subject_for(tool_name, args),
                unsandboxed,
            },
        );
    }

    /// Emit a transcript marker for one tool call.
    #[allow(clippy::too_many_arguments)]
    fn emit_marker(
        &self,
        tool_call_id: Option<&str>,
        tool_name: &str,
        args: &Value,
        kind: &str,
        decision_id: Option<&str>,
        verdict: Option<(chatshell_agent_core::judgment::verdict::RiskLevel, &str)>,
        suggest_mode_switch: bool,
    ) {
        (self.emitter)(
            AUTO_REVIEW_EVENT,
            json!({
                "conversation_id": self.conversation_id,
                "tool_call_id": tool_call_id,
                "decision_id": decision_id,
                "kind": kind,
                "tool_name": tool_name,
                "subject": subject_for(tool_name, args),
                "risk_level": verdict.map(|(risk, _)| risk),
                "rationale": verdict.map(|(_, rationale)| rationale),
                "suggest_mode_switch": suggest_mode_switch,
            }),
        );
    }

    /// Judged auto: a sandbox denial is reported, never asked about.
    fn report_jail_denial(&self, judge: &JudgeSession, request: &EscalationRequest) {
        let call = judge
            .bash_calls
            .lock()
            .unwrap()
            .get(&request.command)
            .cloned();
        let tool_call_id = call.as_ref().and_then(|call| call.tool_call_id.clone());
        // Run-anyway must match the model's retry of the same call, so the
        // action keeps that call's arguments (its `workdir` included).
        let args = call
            .map(|call| call.args)
            .unwrap_or_else(|| json!({ "command": request.command }));
        let record = DecisionRecord::jail_denied(
            &self.conversation_id,
            tool_call_id.as_deref(),
            &request.command,
            &request.detail,
            &judge.model.label(),
        );
        let decision_id = record.id.clone();
        judge.record(record);
        tracing::info!(
            "🛡️ [permission] bash [command redacted] -> sandbox blocked {:?}, reported (run anyway available)",
            request.kind
        );
        self.remember_denial(&decision_id, "bash", &args, true);
        self.emit_marker(
            tool_call_id.as_deref(),
            "bash",
            &args,
            "jail_denied",
            Some(&decision_id),
            None,
            false,
        );
    }

    /// A prompt in `ask`. In a jail, a bash prompt is about an escape (or
    /// a forced signal): its approval authorizes the delta an `auto` allow
    /// would produce, and detected egress goes straight to the network
    /// card, so one action yields one card (ADR 08 §1).
    async fn ask_prompt(
        &self,
        ctx: &GateContext,
        tool_name: &str,
        args: &Value,
        subject: String,
        forced: Option<ForcedPrompt>,
    ) -> (CheckOutcome, String) {
        let jailed_bash = tool_name == "bash" && ctx.sandbox_available;
        match forced {
            // The network card: its answer sets the session flag (a human
            // may choose it), so the plan carries the write widening only.
            Some(ForcedPrompt {
                kind: ForcedPromptKind::Network,
                detail,
            }) if jailed_bash => {
                let plan = escape_delta(args, ctx, None);
                self.network_before_execution(args, subject, detail, plan)
                    .await
            }
            // Any other jailed bash card: a command flagged ahead of the
            // egress check (security -> unparsed -> egress) may contact the
            // network too. Its approval opens the network for that one run,
            // disclosed on the card, as an `auto` allow would — never a
            // second card after a network denial (ADR 08 single prompt).
            forced => {
                let plan = jailed_bash.then(|| {
                    let egress = args
                        .get("command")
                        .and_then(Value::as_str)
                        .and_then(net_policy::detect_egress);
                    escape_delta(args, ctx, egress.as_deref())
                });
                self.prompt(tool_name, args, subject, forced, plan).await
            }
        }
    }

    /// Authorize an approved escape's delta for the call's one execution.
    /// The bash tool notes the widening on the result (the audit channel).
    fn authorize_escape(&self, args: &Value, plan: &EscapePlan) {
        if let (Some(delta), Some(command)) =
            (&plan.delta, args.get("command").and_then(Value::as_str))
        {
            self.environment
                .deltas
                .authorize(command, bash_workdir(args), delta.clone());
        }
    }

    /// Pre-execution network card (jailed bash + egress). Approval sets
    /// the session flag and, for a command that also writes outside the
    /// roots, authorizes that widening too (one card, ADR 08 §1).
    async fn network_before_execution(
        &self,
        args: &Value,
        command: String,
        detail: String,
        plan: EscapePlan,
    ) -> (CheckOutcome, String) {
        let decision = self
            .escalation_card(
                EscalationRequest {
                    command,
                    kind: EscalationKind::Network,
                    detail,
                },
                false,
                Some(&plan),
            )
            .await;
        match decision {
            EscalationDecision::AllowNetworkSession => {
                if let Some(flag) = &self.environment.network_flag {
                    flag.store(true, Ordering::SeqCst);
                }
                self.authorize_escape(args, &plan);
                (
                    CheckOutcome::Allow,
                    "user: allow network this session".to_string(),
                )
            }
            _ => (
                CheckOutcome::Deny(
                    "User did not allow network access for this command. Do not retry it; \
                     ask the user how to proceed."
                        .to_string(),
                ),
                "network card not allowed".to_string(),
            ),
        }
    }

    async fn prompt(
        &self,
        tool_name: &str,
        args: &Value,
        subject: String,
        forced: Option<ForcedPrompt>,
        escape: Option<EscapePlan>,
    ) -> (CheckOutcome, String) {
        // Forced prompts are about this specific call: never offer a
        // session grant or remembering for them. Neither for a jailed bash
        // card (`escape` is set): it is about an escape, which the resolver
        // checks before any grant, so a grant would never apply.
        let (scope, remember) = match (&forced, &escape) {
            (Some(_), _) | (None, Some(_)) => (None, None),
            (None, None) => (
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
                "escape": escape.as_ref().map_or(Value::Null, escape_payload),
            }),
        );
        tracing::info!(
            "🛡️ [permission] Prompting for {} {} (request {})",
            tool_name,
            log_subject(tool_name, args),
            request_id
        );

        let answer = tokio::time::timeout(self.timeout, receiver).await;
        let remembered = if let Ok(Ok(ApprovalAnswer {
            decision: ApprovalDecision::AllowOnce | ApprovalDecision::AllowSession,
            remember: true,
        })) = &answer
            && let Some(remember) = &remember
        {
            self.remember_grant(tool_name, remember).await
        } else {
            false
        };
        let remembered_note = if remembered {
            ", remembered on this device"
        } else {
            ""
        };
        let decision = answer.map(|received| received.map(|answer| answer.decision));
        if let (Ok(Ok(ApprovalDecision::AllowOnce | ApprovalDecision::AllowSession)), Some(plan)) =
            (&decision, &escape)
        {
            self.authorize_escape(args, plan);
        }
        match decision {
            Ok(Ok(ApprovalDecision::AllowOnce)) => (
                CheckOutcome::Allow,
                format!("user: allow once{remembered_note}"),
            ),
            Ok(Ok(ApprovalDecision::AllowSession)) => {
                if let Some(scope) = scope {
                    self.store_grant(&scope);
                }
                (
                    CheckOutcome::Allow,
                    format!("user: allow for this session{remembered_note}"),
                )
            }
            // Escalation answers never apply to a pre-execution prompt;
            // treat a mismatched answer as a denial (fail closed).
            Ok(Ok(
                ApprovalDecision::Deny
                | ApprovalDecision::RetryUnsandboxed
                | ApprovalDecision::AllowNetworkSession,
            )) => (
                CheckOutcome::Deny("User denied this tool call".to_string()),
                "user: deny".to_string(),
            ),
            Ok(Err(_dropped)) => {
                // The awaiting hook future was dropped (stream cancelled).
                self.emit_resolved(&request_id);
                (
                    CheckOutcome::Deny("Approval request cancelled".to_string()),
                    "approval cancelled".to_string(),
                )
            }
            Err(_elapsed) => {
                self.registry.resolve(&request_id, ApprovalDecision::Deny);
                self.emit_resolved(&request_id);
                (
                    CheckOutcome::Deny(TIMEOUT_DENY_REASON.to_string()),
                    "approval timed out".to_string(),
                )
            }
        }
    }
}

impl PermissionGate {
    /// Ask the user how to handle a command the OS sandbox blocked.
    /// Timeout, cancellation, and any non-escalation answer resolve to
    /// `Deny` (fail closed).
    pub async fn escalate(&self, request: EscalationRequest) -> EscalationDecision {
        // Judged auto never shows the FR-18 card: the denial becomes a
        // tool-result annotation plus a `jail-denied` marker whose
        // run-anyway retries once outside the sandbox.
        if let Some(judge) = self.environment.judge.clone() {
            self.report_jail_denial(&judge, &request);
            return EscalationDecision::Reported;
        }
        self.escalation_card(request, true, None).await
    }

    /// Show an escalation card. `retry_option` offers "run once outside
    /// the sandbox" (only meaningful after a sandboxed run failed);
    /// `escape` discloses a write widening the approval also carries.
    async fn escalation_card(
        &self,
        request: EscalationRequest,
        retry_option: bool,
        escape: Option<&EscapePlan>,
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
                    "kind": match request.kind {
                        EscalationKind::Network => "sandbox_network",
                        EscalationKind::Credentials => "sandbox_credentials",
                        EscalationKind::Filesystem => "sandbox",
                    },
                    "detail": request.detail,
                },
                "grant": Value::Null,
                "remember": Value::Null,
                "escalation": { "network_option": network, "retry_option": retry_option },
                "escape": escape.map_or(Value::Null, escape_payload),
            }),
        );
        tracing::info!(
            "🛡️ [permission] Sandbox escalation (request {})",
            request_id
        );
        let (decision, how) = match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(answer)) => match answer.decision {
                ApprovalDecision::RetryUnsandboxed if retry_option => (
                    EscalationDecision::RetryUnsandboxed,
                    "user: run once outside the sandbox",
                ),
                ApprovalDecision::AllowNetworkSession if network => (
                    EscalationDecision::AllowNetworkSession,
                    "user: allow network this session",
                ),
                _ => (EscalationDecision::Deny, "user: deny"),
            },
            Ok(Err(_dropped)) => {
                self.emit_resolved(&request_id);
                (EscalationDecision::Deny, "card cancelled")
            }
            Err(_elapsed) => {
                self.registry.resolve(&request_id, ApprovalDecision::Deny);
                self.emit_resolved(&request_id);
                (EscalationDecision::Deny, "card timed out")
            }
        };
        tracing::info!(
            "🛡️ [permission] Sandbox escalation (request {}) -> {}",
            request_id,
            how
        );
        decision
    }
}

/// Longest non-secret subject kept on a log line.
const LOG_TEXT_CHARS: usize = 200;

/// `text` on one line, bounded, for INFO lines.
fn log_text(text: &str) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let total = flat.chars().count();
    if total <= LOG_TEXT_CHARS {
        return flat;
    }
    let kept: String = flat.chars().take(LOG_TEXT_CHARS).collect();
    format!("{kept}… (+{} chars)", total - LOG_TEXT_CHARS)
}

/// The INFO line of one gate decision: what ran or not, and why.
fn decision_line(tool_name: &str, args: &Value, outcome: &CheckOutcome, source: &str) -> String {
    match outcome {
        CheckOutcome::Allow => format!(
            "🛡️ [permission] {} {} -> allowed ({})",
            tool_name,
            log_subject(tool_name, args),
            source
        ),
        CheckOutcome::Deny(_) => format!(
            "🛡️ [permission] {} {} -> denied ({})",
            tool_name,
            log_subject(tool_name, args),
            source
        ),
    }
}

/// The call's subject for log lines.
fn log_subject(tool_name: &str, args: &Value) -> String {
    // Omit payloads rather than guessing which shell arguments or URL parts
    // contain secrets. Reasons and judge rationale can echo those payloads too.
    match tool_name {
        "bash" => "[command redacted]".to_string(),
        "web_fetch" => "[URL redacted]".to_string(),
        _ => log_text(&subject_for(tool_name, args)),
    }
}

/// A verdict axis as its wire name (`high`, `unknown`, ...).
fn wire_name<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Why the resolver allowed a call without asking, for the log.
fn allow_source(
    mode: PermissionMode,
    ctx: &GateContext,
    tool_name: &str,
    args: &Value,
) -> &'static str {
    if mode == PermissionMode::Yolo {
        return "yolo mode";
    }
    if tool_name == "bash" && args.get("command").and_then(Value::as_str).is_none() {
        return "no command (the tool reports it)";
    }
    if PermissionTier::for_tool(tool_name) == PermissionTier::Read {
        return "read-only tool";
    }
    if tool_name == "bash" && ctx.sandbox_available {
        return "runs in the sandbox";
    }
    if mode == PermissionMode::Auto
        && matches!(tool_name, "edit" | "write")
        && let (Some(path), Some(workspace)) = (
            args.get("path").and_then(Value::as_str),
            ctx.workspace.as_deref(),
        )
        && chatshell_agent_core::permission::inside_workspace(path, workspace)
    {
        return "inside the workspace";
    }
    "session or remembered grant"
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

/// Wire shape of an approval's widening in `permission-requested`: the
/// directories it opens for the one execution, the egress it opens the
/// network for (that run only), and the targets no bounded widening can
/// open (they run jailed; a denial card follows).
fn escape_payload(plan: &EscapePlan) -> Value {
    let paths = |paths: &[PathBuf]| -> Vec<String> {
        paths.iter().map(|p| p.display().to_string()).collect()
    };
    let roots = plan
        .delta
        .as_ref()
        .map(|delta| paths(&delta.writable_roots))
        .unwrap_or_default();
    if roots.is_empty() && plan.unbounded.is_empty() && plan.network.is_none() {
        return Value::Null;
    }
    json!({
        "writable_roots": roots,
        "unbounded": paths(&plan.unbounded),
        "network": plan.network,
    })
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

/// One review, bounded by `timeout` (retries included). `what` names the
/// call in the timeout warning.
#[allow(clippy::too_many_arguments)]
async fn timed_review(
    model: Arc<dyn JudgeModel>,
    params: JudgeParams,
    posture: Posture,
    transcript: chatshell_agent_core::judgment::AssembledTranscript,
    request: JudgmentRequest,
    cancel: CancellationToken,
    timeout: Duration,
    what: String,
) -> Review {
    let started = std::time::Instant::now();
    match tokio::time::timeout(
        timeout,
        review_engine::review(
            model.as_ref(),
            &params,
            &posture,
            &transcript,
            &request,
            &cancel,
        ),
    )
    .await
    {
        Ok(review) => review,
        Err(_elapsed) => {
            tracing::warn!("🛡️ [auto_review] Review of {what} exceeded {timeout:?}");
            Review {
                outcome: ReviewOutcome::Failed {
                    failure: ReviewFailure::Unavailable(
                        "the review did not finish in time".to_string(),
                    ),
                },
                attempts: 2,
                duration: started.elapsed(),
                model: model.label(),
                max_tokens: params.max_tokens,
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
    /// The model's turn is complete and its tool calls are about to run
    /// one by one: start their reviews together.
    fn on_model_turn_finished(
        &self,
        _ctx: &HookContext,
        event: ModelTurnFinished<'_>,
    ) -> impl Future<Output = ModelTurnAction> + Send {
        let calls: Vec<(String, Value)> = event
            .content
            .iter()
            .filter_map(|content| match content {
                rig::message::AssistantContent::ToolCall(call) => {
                    Some((call.function.name.clone(), call.function.arguments.clone()))
                }
                _ => None,
            })
            .collect();
        if !calls.is_empty() {
            self.gate.prefetch_reviews(&calls);
        }
        async { ModelTurnAction::Continue }
    }

    fn on_tool_call(
        &self,
        _ctx: &HookContext,
        event: ToolCall<'_>,
    ) -> impl Future<Output = ToolCallAction> + Send {
        let gate = self.gate.clone();
        let tool_name = event.tool_name.to_string();
        let tool_call_id = event.tool_call_id.map(str::to_string);
        let args: Value = serde_json::from_str(event.args).unwrap_or(Value::Null);
        async move {
            // The gate logs every decision itself.
            let outcome = gate
                .check_call(tool_call_id.as_deref(), &tool_name, &args)
                .await;
            to_action(outcome)
        }
    }

    /// Images inside text results (`data:image/...;base64,` lines from the
    /// read tool) go to the model as image blocks, not as base64 text.
    fn on_tool_result(
        &self,
        _ctx: &HookContext,
        event: ToolResultEvent<'_>,
    ) -> impl Future<Output = ToolResultAction> + Send {
        let action = event
            .presentation
            .as_text()
            .and_then(chatshell_agent_core::tool_images::tool_result_content)
            .and_then(|content| rig::tool::ToolOutput::content(content).ok())
            .map(ToolResultAction::rewrite_output)
            .unwrap_or_else(ToolResultAction::keep);
        async move { action }
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
    async fn credential_escalation_offers_a_retry_without_network() {
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.escalate(escalation(EscalationKind::Credentials)).await }
        });
        answer_when_prompted(
            &f.registry,
            &f.captured,
            ApprovalDecision::RetryUnsandboxed,
            0,
        )
        .await;
        assert_eq!(task.await.unwrap(), EscalationDecision::RetryUnsandboxed);
        let payload = requested_payloads(&f.captured)[0].clone();
        assert_eq!(payload["warning"]["kind"], json!("sandbox_credentials"));
        assert_eq!(payload["escalation"]["network_option"], json!(false));
        assert_eq!(payload["escalation"]["retry_option"], json!(true));
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
    fn ask_and_auto_share_the_jail_and_yolo_never_uses_it() {
        assert!(sandbox_enabled_for(PermissionMode::Auto));
        assert!(sandbox_enabled_for(PermissionMode::Ask));
        assert!(!sandbox_enabled_for(PermissionMode::Yolo));
    }

    #[test]
    fn auto_runs_as_ask_without_an_eligible_judge() {
        use review_engine::AutoResolution::{Ask, Judged};
        assert_eq!(
            effective_mode(PermissionMode::Auto, Ask),
            PermissionMode::Ask
        );
        assert_eq!(
            effective_mode(PermissionMode::Auto, Judged),
            PermissionMode::Auto
        );
        assert_eq!(
            effective_mode(PermissionMode::Yolo, Ask),
            PermissionMode::Yolo
        );
        assert_eq!(
            effective_mode(PermissionMode::Ask, Judged),
            PermissionMode::Ask
        );
    }

    /// Jailed `ask` (the old ineligible-judge `auto` posture, ADR 08 §3).
    fn jailed_ask_fixture(network: Arc<AtomicBool>) -> Fixture {
        jailed_ask_fixture_with(network, std::env::temp_dir(), ExecutionDeltas::default())
    }

    fn jailed_ask_fixture_with(
        network: Arc<AtomicBool>,
        workspace: PathBuf,
        deltas: ExecutionDeltas,
    ) -> Fixture {
        let registry = ApprovalRegistry::new();
        let grants: GrantStore = Arc::new(Mutex::new(HashMap::new()));
        let (emitter, captured) = test_emitter();
        let gate = PermissionGate::with_environment(
            "conv-1".to_string(),
            PermissionMode::Ask,
            grants.clone(),
            registry.clone(),
            emitter,
            GateEnvironment {
                workspace: Some(workspace),
                sandbox_available: true,
                network_flag: Some(network),
                scratch_dir: None,
                judge: None,
                deltas,
                cwd_drifted: None,
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
    async fn jailed_ask_egress_asks_once_with_the_network_card() {
        let network = Arc::new(AtomicBool::new(false));
        let f = jailed_ask_fixture(network.clone());
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
    async fn jailed_ask_runs_plain_commands_silently() {
        let f = jailed_ask_fixture(Arc::new(AtomicBool::new(false)));
        assert_eq!(
            f.gate.check("bash", &bash("cargo build")).await,
            CheckOutcome::Allow
        );
        assert!(requested_payloads(&f.captured).is_empty());
    }

    #[tokio::test]
    async fn retry_answer_is_rejected_on_a_pre_execution_card() {
        let network = Arc::new(AtomicBool::new(false));
        let f = jailed_ask_fixture(network.clone());
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

    #[tokio::test]
    async fn jailed_ask_matrix_prompts_keep_their_grants() {
        let f = jailed_ask_fixture(Arc::new(AtomicBool::new(false)));
        // Matrix arm (MCP): the plain prompt with its pair grant, as in v2.
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move {
                gate.check("mcp_tool_use", &json!({ "server": "s", "tool": "t" }))
                    .await
            }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowSession, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        let payload = requested_payloads(&f.captured)[0].clone();
        assert_eq!(payload["warning"], Value::Null);
        assert_eq!(payload["grant"]["kind"], json!("server_tool"));
        // The session grant it minted short-circuits the next call.
        assert_eq!(
            f.gate
                .check("mcp_tool_use", &json!({ "server": "s", "tool": "t" }))
                .await,
            CheckOutcome::Allow
        );
        assert_eq!(requested_payloads(&f.captured).len(), 1);
    }

    #[tokio::test]
    async fn sensitive_writes_prompt_with_their_warning_and_no_grant() {
        let f = fixture(PermissionMode::Ask);
        let target = dirs::home_dir().unwrap().join(".claude/settings.json");
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move {
                gate.check("write", &json!({ "path": target.to_str().unwrap() }))
                    .await
            }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::Deny, 0).await;
        assert!(matches!(task.await.unwrap(), CheckOutcome::Deny(_)));
        let payload = requested_payloads(&f.captured)[0].clone();
        assert_eq!(payload["warning"]["kind"], json!("sensitive_write"));
        assert_eq!(payload["grant"], Value::Null);
        assert_eq!(payload["remember"], Value::Null);
    }

    // ---- judged auto (permission v3, Phase C) -----------------------------

    use chatshell_agent_core::judgment::engine::{JudgeCall, JudgeError};
    use futures::future::BoxFuture;
    use std::collections::VecDeque;

    const JUDGE_ALLOW: &str = r#"{"risk_level":"medium","user_authorization":"high","outcome":"allow","rationale":"Requested."}"#;
    const JUDGE_DENY: &str = r#"{"risk_level":"high","user_authorization":"unknown","outcome":"deny","rationale":"Not requested."}"#;

    /// Scripted judge: pops one reply per call (hangs when out of replies),
    /// after an optional delay; records every user message it saw.
    struct ScriptedJudge {
        replies: Mutex<VecDeque<&'static str>>,
        seen: Mutex<Vec<String>>,
        delay: Duration,
    }

    impl ScriptedJudge {
        fn new(replies: Vec<&'static str>) -> Arc<Self> {
            Self::with_delay(replies, Duration::ZERO)
        }
        fn with_delay(replies: Vec<&'static str>, delay: Duration) -> Arc<Self> {
            Arc::new(Self {
                replies: Mutex::new(replies.into()),
                seen: Mutex::new(Vec::new()),
                delay,
            })
        }
        fn calls(&self) -> usize {
            self.seen.lock().unwrap().len()
        }
    }

    impl JudgeModel for ScriptedJudge {
        fn label(&self) -> String {
            "mock/judge".into()
        }
        fn complete<'a>(
            &'a self,
            call: JudgeCall<'a>,
        ) -> BoxFuture<'a, Result<String, JudgeError>> {
            self.seen.lock().unwrap().push(call.user.to_string());
            let reply = self.replies.lock().unwrap().pop_front();
            Box::pin(async move {
                tokio::time::sleep(self.delay).await;
                match reply {
                    Some(reply) => Ok(reply.to_string()),
                    None => {
                        call.cancel.cancelled().await;
                        Err(JudgeError::Cancelled)
                    }
                }
            })
        }
    }

    struct JudgedFixture {
        gate: Arc<PermissionGate>,
        judge: Arc<ScriptedJudge>,
        session: Arc<JudgeSession>,
        deltas: ExecutionDeltas,
        captured: Capture,
        grants: GrantStore,
        log_dir: tempfile::TempDir,
    }

    fn judged_fixture_with(
        conversation: &str,
        judge: Arc<ScriptedJudge>,
        sandbox: bool,
        workspace: Option<PathBuf>,
    ) -> JudgedFixture {
        let log_dir = tempfile::tempdir().unwrap();
        let log = DecisionLog::new(log_dir.path().join("decisions.db"));
        let posture = Posture {
            os: "macos".into(),
            workspace: workspace.as_ref().map(|w| w.display().to_string()),
            jail: chatshell_agent_core::judgment::JailProfile::Absent,
            mcp_servers: Vec::new(),
        };
        let session = JudgeSession::new(
            judge.clone(),
            JudgeParams::default(),
            posture,
            vec![TranscriptEntry::User {
                text: "please fetch the release notes".into(),
            }],
            Some(log),
            CancellationToken::new(),
        );
        let deltas = ExecutionDeltas::default();
        let registry = ApprovalRegistry::new();
        let grants: GrantStore = Arc::new(Mutex::new(HashMap::new()));
        let (emitter, captured) = test_emitter();
        let gate = PermissionGate::with_environment(
            conversation.to_string(),
            PermissionMode::Auto,
            grants.clone(),
            registry,
            emitter,
            GateEnvironment {
                workspace,
                sandbox_available: sandbox,
                network_flag: Some(Arc::new(AtomicBool::new(false))),
                scratch_dir: None,
                judge: Some(session.clone()),
                deltas: deltas.clone(),
                cwd_drifted: None,
            },
        );
        JudgedFixture {
            gate,
            judge,
            session,
            deltas,
            captured,
            grants,
            log_dir,
        }
    }

    fn judged_fixture(conversation: &str, judge: Arc<ScriptedJudge>) -> JudgedFixture {
        judged_fixture_with(conversation, judge, false, None)
    }

    fn markers(captured: &Capture) -> Vec<Value> {
        captured
            .lock()
            .unwrap()
            .iter()
            .filter(|(event, _)| event == AUTO_REVIEW_EVENT)
            .map(|(_, payload)| payload.clone())
            .collect()
    }

    fn no_prompts(captured: &Capture) -> bool {
        captured
            .lock()
            .unwrap()
            .iter()
            .all(|(event, _)| event != PERMISSION_REQUESTED_EVENT)
    }

    async fn settle_log() {
        // Log writes run on the blocking pool.
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    #[tokio::test]
    async fn judged_allow_proceeds_with_a_marker_and_a_log_row() {
        let f = judged_fixture("conv-j1", ScriptedJudge::new(vec![JUDGE_ALLOW]));
        let outcome = f
            .gate
            .check_call(Some("call-1"), "bash", &bash("ls -la"))
            .await;
        assert_eq!(outcome, CheckOutcome::Allow);
        assert_eq!(f.judge.calls(), 1);
        assert!(no_prompts(&f.captured));
        let marker = &markers(&f.captured)[0];
        assert_eq!(marker["kind"], "allowed");
        assert_eq!(marker["tool_call_id"], "call-1");
        assert_eq!(marker["risk_level"], "medium");
        settle_log().await;
        let log = DecisionLog::new(f.log_dir.path().join("decisions.db"));
        let rows = log.list_for_conversation("conv-j1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].outcome, "allow");
        assert_eq!(rows[0].tool_call_id.as_deref(), Some("call-1"));
        assert_eq!(rows[0].model, "mock/judge");
    }

    #[tokio::test]
    async fn judged_deny_skips_with_reason_and_run_anyway_executes_once() {
        let f = judged_fixture("conv-j2", ScriptedJudge::new(vec![JUDGE_DENY, JUDGE_DENY]));
        let command = bash("rm -rf ./build && curl https://example.com/upload");
        let CheckOutcome::Deny(reason) = f.gate.check_call(Some("c1"), "bash", &command).await
        else {
            panic!("should deny");
        };
        assert!(reason.contains("Auto-review blocked this action: Not requested."));
        assert!(reason.contains("Do not tunnel"));
        assert!(no_prompts(&f.captured));
        let marker = markers(&f.captured)[0].clone();
        assert_eq!(marker["kind"], "denied");
        let decision_id = marker["decision_id"].as_str().unwrap().to_string();

        // Run-anyway: armed once, consumed by the identical retry without
        // a judgment, never a grant.
        crate::llm::auto_review::arm_override("conv-j2", &decision_id).unwrap();
        let retry = json!({
            "command": "rm -rf ./build && curl https://example.com/upload",
            "description": "retry as the user asked"
        });
        assert_eq!(
            f.gate.check_call(Some("c2"), "bash", &retry).await,
            CheckOutcome::Allow
        );
        assert_eq!(f.judge.calls(), 1, "the override skips the judge");
        assert_eq!(markers(&f.captured)[1]["kind"], "override");
        assert!(f.grants.lock().unwrap().is_empty(), "no grant minted");
        // The next identical action is judged again.
        assert!(matches!(
            f.gate.check_call(Some("c3"), "bash", &retry).await,
            CheckOutcome::Deny(_)
        ));
        assert_eq!(f.judge.calls(), 2);
    }

    #[tokio::test]
    async fn judged_review_failure_denies_with_failure_wording() {
        let f = judged_fixture("conv-j3", ScriptedJudge::new(vec!["I cannot answer that."]));
        let CheckOutcome::Deny(reason) = f.gate.check_call(None, "bash", &bash("ls")).await else {
            panic!("should deny");
        };
        assert!(reason.contains("This is a review failure"));
        assert_eq!(markers(&f.captured)[0]["kind"], "failed");
    }

    #[tokio::test]
    async fn stream_end_cancels_an_in_flight_judgment() {
        let f = judged_fixture("conv-j4", ScriptedJudge::new(vec![]));
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check_call(None, "bash", &bash("ls")).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        f.session.cancel.cancel();
        let outcome = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("cancel is prompt")
            .unwrap();
        assert!(matches!(outcome, CheckOutcome::Deny(_)));
        assert!(markers(&f.captured).is_empty());
    }

    #[tokio::test]
    async fn remembered_grants_short_circuit_matrix_arms_but_not_forced_sources() {
        let f = judged_fixture("conv-j5", ScriptedJudge::new(vec![JUDGE_DENY]));
        f.grants
            .lock()
            .unwrap()
            .entry("conv-j5".into())
            .or_default()
            .grant_server_tool("github", "list_issues");
        f.grants
            .lock()
            .unwrap()
            .entry("conv-j5".into())
            .or_default()
            .grant_bash_commands(&["echo"]);
        let mcp = json!({ "server": "github", "tool": "list_issues" });
        assert_eq!(
            f.gate.check_call(None, "mcp_tool_use", &mcp).await,
            CheckOutcome::Allow
        );
        assert_eq!(
            f.judge.calls(),
            0,
            "the grant is a fast path, not a judgment"
        );
        // A Warn-forced command is judged despite the `echo` grant.
        assert!(matches!(
            f.gate
                .check_call(None, "bash", &bash("echo $(whoami)"))
                .await,
            CheckOutcome::Deny(_)
        ));
        assert_eq!(f.judge.calls(), 1);
    }

    #[tokio::test]
    async fn two_conversations_are_judged_concurrently() {
        let delay = Duration::from_millis(300);
        let a = judged_fixture(
            "conv-ca",
            ScriptedJudge::with_delay(vec![JUDGE_ALLOW], delay),
        );
        let b = judged_fixture(
            "conv-cb",
            ScriptedJudge::with_delay(vec![JUDGE_ALLOW], delay),
        );
        let ls = bash("ls");
        let started = std::time::Instant::now();
        let (ra, rb) = tokio::join!(
            a.gate.check_call(None, "bash", &ls),
            b.gate.check_call(None, "bash", &ls)
        );
        assert_eq!((ra, rb), (CheckOutcome::Allow, CheckOutcome::Allow));
        assert!(
            started.elapsed() < delay * 2,
            "serialized: {:?}",
            started.elapsed()
        );
    }

    #[tokio::test]
    async fn allowed_egress_authorizes_network_for_one_execution_only() {
        let workspace = tempfile::tempdir().unwrap();
        let f = judged_fixture_with(
            "conv-j6",
            ScriptedJudge::new(vec![JUDGE_ALLOW]),
            true,
            Some(workspace.path().to_path_buf()),
        );
        let command = "curl https://example.com/notes";
        assert_eq!(
            f.gate.check_call(Some("n1"), "bash", &bash(command)).await,
            CheckOutcome::Allow
        );
        let delta = f.deltas.take(command, None).expect("network delta");
        assert!(delta.network && !delta.unsandboxed);
        // The session-sticky flag stays off.
        assert!(!f.gate.context().network_allowed);
        settle_log().await;
        let log = DecisionLog::new(f.log_dir.path().join("decisions.db"));
        let row = &log.list_for_conversation("conv-j6").unwrap()[0];
        assert_eq!(row.jail_delta.as_deref(), Some("network access"));
    }

    #[tokio::test]
    async fn sandbox_denials_are_reported_not_asked_and_run_anyway_goes_unsandboxed() {
        let workspace = tempfile::tempdir().unwrap();
        let f = judged_fixture_with(
            "conv-j7",
            ScriptedJudge::new(vec![]),
            true,
            Some(workspace.path().to_path_buf()),
        );
        let command = "cat ~/.ssh/config";
        // The sandboxed run is allowed without a judgment (jail absorbs it).
        assert_eq!(
            f.gate.check_call(Some("j1"), "bash", &bash(command)).await,
            CheckOutcome::Allow
        );
        let decision = f
            .gate
            .escalate(EscalationRequest {
                command: command.into(),
                kind: EscalationKind::Filesystem,
                detail: "Operation not permitted".into(),
            })
            .await;
        assert_eq!(decision, EscalationDecision::Reported);
        assert!(no_prompts(&f.captured), "no FR-18 card in judged auto");
        let marker = markers(&f.captured)[0].clone();
        assert_eq!(marker["kind"], "jail_denied");
        assert_eq!(marker["tool_call_id"], "j1");
        let decision_id = marker["decision_id"].as_str().unwrap();
        crate::llm::auto_review::arm_override("conv-j7", decision_id).unwrap();
        assert_eq!(
            f.gate.check_call(Some("j2"), "bash", &bash(command)).await,
            CheckOutcome::Allow
        );
        let delta = f.deltas.take(command, None).expect("unsandboxed once");
        assert!(delta.unsandboxed);
        assert_eq!(f.judge.calls(), 0);
    }

    #[tokio::test]
    async fn run_anyway_on_a_sandbox_denial_matches_a_retry_with_its_workdir() {
        let workspace = tempfile::tempdir().unwrap();
        let workdir = workspace.path().join("sub");
        std::fs::create_dir_all(&workdir).unwrap();
        let workdir = workdir.to_str().unwrap().to_string();
        let f = judged_fixture_with(
            "conv-j7w",
            ScriptedJudge::new(vec![]),
            true,
            Some(workspace.path().to_path_buf()),
        );
        let command = "cat ~/.ssh/config";
        let call = json!({ "command": command, "workdir": workdir, "description": "first" });
        assert_eq!(
            f.gate.check_call(Some("w1"), "bash", &call).await,
            CheckOutcome::Allow
        );
        f.gate
            .escalate(EscalationRequest {
                command: command.into(),
                kind: EscalationKind::Filesystem,
                detail: "Operation not permitted".into(),
            })
            .await;
        let marker = markers(&f.captured)[0].clone();
        assert_eq!(marker["kind"], "jail_denied");
        let decision_id = marker["decision_id"].as_str().unwrap();
        crate::llm::auto_review::arm_override("conv-j7w", decision_id).unwrap();
        // The model retries the same call; its free-text description differs.
        let retry = json!({ "command": command, "workdir": workdir, "description": "retry" });
        assert_eq!(
            f.gate.check_call(Some("w2"), "bash", &retry).await,
            CheckOutcome::Allow
        );
        let delta = f
            .deltas
            .take(command, Some(&workdir))
            .expect("unsandboxed once, keyed by the workdir");
        assert!(delta.unsandboxed);
        assert!(f.deltas.is_empty());
    }

    #[tokio::test]
    async fn the_judge_sees_this_turns_earlier_tool_inputs() {
        let f = judged_fixture(
            "conv-j8",
            ScriptedJudge::new(vec![JUDGE_ALLOW, JUDGE_ALLOW]),
        );
        f.gate
            .check_call(None, "bash", &bash("git log --oneline -3"))
            .await;
        f.gate
            .check_call(None, "bash", &bash("git push origin main"))
            .await;
        let seen = f.judge.seen.lock().unwrap();
        let second = &seen[1];
        assert!(
            second.contains("user: \"please fetch the release notes\""),
            "{second}"
        );
        assert!(second.contains("git log --oneline -3"), "{second}");
        // The current action is the action, not an earlier input.
        let transcript = second.split("</transcript>").next().unwrap();
        assert!(!transcript.contains("git push origin main"), "{transcript}");
    }

    #[tokio::test]
    async fn every_decision_reports_its_source_on_one_line() {
        // A user answer.
        let f = fixture(PermissionMode::Ask);
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.decide(None, "bash", &bash("git status")).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowSession, 0).await;
        let answered = task.await.unwrap();
        // A grant fast path and a policy denial.
        let granted = f
            .gate
            .decide(None, "bash", &bash("git status --short"))
            .await;
        let blocked = f.gate.decide(None, "bash", &bash("rm -rf /")).await;
        // A reviewer verdict.
        let j = judged_fixture("conv-log", ScriptedJudge::new(vec![JUDGE_DENY]));
        let reviewed = j.gate.decide(None, "bash", &bash("ls")).await;

        let line = |args: Value, (outcome, source): &(CheckOutcome, String)| {
            decision_line("bash", &args, outcome, source)
        };
        assert_eq!(
            line(bash("git status"), &answered),
            "🛡️ [permission] bash [command redacted] -> allowed (user: allow for this session)"
        );
        assert_eq!(
            line(bash("git status --short"), &granted),
            "🛡️ [permission] bash [command redacted] -> allowed (session or remembered grant)"
        );
        assert!(
            line(bash("rm -rf /"), &blocked)
                .starts_with("🛡️ [permission] bash [command redacted] -> denied (policy)"),
            "{}",
            line(bash("rm -rf /"), &blocked)
        );
        let reviewed = line(bash("ls"), &reviewed);
        assert!(
            reviewed.starts_with(
                "🛡️ [permission] bash [command redacted] -> denied (auto-review: high risk, unknown authorization; "
            ),
            "{reviewed}"
        );
        assert!(reviewed.contains("mock/judge"), "{reviewed}");
        assert!(!reviewed.contains('\n'));
    }

    #[tokio::test]
    async fn remembered_source_requires_a_successful_save() {
        let dir = tempfile::tempdir().unwrap();
        let valid = PersistentGrantStore::new(dir.path().join("grants.db"));
        // A directory cannot be opened as a SQLite database.
        let invalid = PersistentGrantStore::new(dir.path());
        for (store, expected) in [
            (None, false),
            (Some(invalid), false),
            (Some(valid.clone()), true),
        ] {
            let f = fixture_with_store(PermissionMode::Ask, store);
            let task = tokio::spawn({
                let gate = f.gate.clone();
                async move { gate.decide(None, "bash", &bash("git status")).await }
            });
            answer_remembering(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
            let (outcome, source) = task.await.unwrap();
            assert_eq!(outcome, CheckOutcome::Allow);
            assert_eq!(
                source.contains("remembered on this device"),
                expected,
                "{source}"
            );
        }
        assert!(!valid.keys().unwrap().is_empty());
    }

    #[tokio::test]
    async fn decision_logs_omit_payloads_and_echoed_reasons() {
        let secret = "secret-token-123";
        for (tool, args) in [
            ("bash", bash(&format!("TOKEN={secret} deploy"))),
            (
                "web_fetch",
                json!({"url": format!("https://user:{secret}@example.com/?token={secret}")}),
            ),
        ] {
            for outcome in [CheckOutcome::Allow, CheckOutcome::Deny(secret.into())] {
                let line = decision_line(tool, &args, &outcome, "policy");
                assert!(!line.contains(secret), "{line}");
                assert!(line.contains("redacted"), "{line}");
            }
        }
        // A judge can echo a secret from the action in its rationale.
        let reply = r#"{"outcome":"deny","risk_level":"high","user_authorization":"unknown","rationale":"secret-token-123"}"#;
        let j = judged_fixture("conv-secret-log", ScriptedJudge::new(vec![reply]));
        let (outcome, source) = j.gate.decide(None, "bash", &bash("ls")).await;
        assert!(matches!(outcome, CheckOutcome::Deny(_)));
        assert!(!source.contains(secret), "{source}");
    }

    #[test]
    fn log_lines_are_single_line_and_bounded() {
        let long = format!("echo {}\n{}", "a".repeat(300), "rm x");
        let line = decision_line(
            "write",
            &json!({ "path": long }),
            &CheckOutcome::Deny("multi\nline reason".into()),
            "policy",
        );
        assert!(!line.contains('\n'), "{line}");
        assert!(line.contains("… (+"), "{line}");
        assert!(!line.contains("multi"), "{line}");
    }

    // ---- ADR 08 SA-3: escape approvals in jailed `ask` ------------------

    #[tokio::test]
    async fn an_approved_write_escape_carries_its_roots_delta() {
        let outside = tempfile::tempdir_in(dirs::home_dir().unwrap()).unwrap();
        let outside = outside.path().canonicalize().unwrap();
        let deltas = ExecutionDeltas::default();
        let f = jailed_ask_fixture_with(
            Arc::new(AtomicBool::new(false)),
            std::env::temp_dir(),
            deltas.clone(),
        );
        let command = format!("cp a {}/f", outside.display());
        let task = tokio::spawn({
            let gate = f.gate.clone();
            let command = command.clone();
            async move { gate.check("bash", &bash(&command)).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        // One card, naming the widened directory...
        let payload = requested_payloads(&f.captured)[0].clone();
        assert_eq!(
            payload["escape"]["writable_roots"],
            json!([outside.display().to_string()])
        );
        assert_eq!(requested_payloads(&f.captured).len(), 1);
        // No grant or remember offer: the escape arm precedes the grant
        // lookup, so a grant would never cover the next run.
        assert_eq!(payload["grant"], Value::Null);
        assert_eq!(payload["remember"], Value::Null);
        // ...whose approval authorizes exactly that widening, once.
        let delta = deltas.take(&command, None).expect("roots delta");
        assert_eq!(delta.writable_roots, vec![outside.clone()]);
        assert!(!delta.network && !delta.unsandboxed);
    }

    #[tokio::test]
    async fn a_denied_write_escape_authorizes_nothing() {
        let outside = tempfile::tempdir_in(dirs::home_dir().unwrap()).unwrap();
        let deltas = ExecutionDeltas::default();
        let f = jailed_ask_fixture_with(
            Arc::new(AtomicBool::new(false)),
            std::env::temp_dir(),
            deltas.clone(),
        );
        let command = format!("cp a {}/f", outside.path().display());
        let task = tokio::spawn({
            let gate = f.gate.clone();
            let command = command.clone();
            async move { gate.check("bash", &bash(&command)).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::Deny, 0).await;
        assert!(matches!(task.await.unwrap(), CheckOutcome::Deny(_)));
        assert!(deltas.is_empty());
    }

    #[tokio::test]
    async fn an_unboundable_escape_is_disclosed_on_its_card() {
        let deltas = ExecutionDeltas::default();
        let f = jailed_ask_fixture_with(
            Arc::new(AtomicBool::new(false)),
            std::env::temp_dir(),
            deltas.clone(),
        );
        // The parent is $HOME: no bounded widening can open it.
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move {
                gate.check("bash", &bash("cp a ~/chatshell-outside.txt"))
                    .await
            }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        let payload = requested_payloads(&f.captured)[0].clone();
        assert_eq!(payload["escape"]["writable_roots"], json!([]));
        assert_eq!(
            payload["escape"]["unbounded"],
            json!([dirs::home_dir()
                .unwrap()
                .canonicalize()
                .unwrap()
                .join("chatshell-outside.txt")
                .display()
                .to_string()])
        );
        // Runs jailed: the denial card follows after execution.
        assert!(deltas.is_empty());
    }

    #[tokio::test]
    async fn combined_egress_and_write_escape_is_one_card() {
        let outside = tempfile::tempdir_in(dirs::home_dir().unwrap()).unwrap();
        let outside = outside.path().canonicalize().unwrap();
        let network = Arc::new(AtomicBool::new(false));
        let deltas = ExecutionDeltas::default();
        let f = jailed_ask_fixture_with(network.clone(), std::env::temp_dir(), deltas.clone());
        let command = format!(
            "curl https://example.com -o x && cp x {}/f",
            outside.display()
        );
        let task = tokio::spawn({
            let gate = f.gate.clone();
            let command = command.clone();
            async move { gate.check("bash", &bash(&command)).await }
        });
        answer_when_prompted(
            &f.registry,
            &f.captured,
            ApprovalDecision::AllowNetworkSession,
            0,
        )
        .await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        let payloads = requested_payloads(&f.captured);
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0]["warning"]["kind"], json!("sandbox_network"));
        assert_eq!(
            payloads[0]["escape"]["writable_roots"],
            json!([outside.display().to_string()])
        );
        assert!(network.load(Ordering::SeqCst));
        let delta = deltas.take(&command, None).expect("roots delta");
        assert_eq!(delta.writable_roots, vec![outside]);
    }

    #[tokio::test]
    async fn a_flagged_command_with_egress_opens_the_network_on_its_one_card() {
        let network = Arc::new(AtomicBool::new(false));
        let deltas = ExecutionDeltas::default();
        let f = jailed_ask_fixture_with(network.clone(), std::env::temp_dir(), deltas.clone());
        // Security outranks egress (security -> unparsed -> egress), so the
        // Security card is the one card; it must carry the network too.
        let command = "curl https://example.com > $out";
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move { gate.check("bash", &bash(command)).await }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::AllowOnce, 0).await;
        assert_eq!(task.await.unwrap(), CheckOutcome::Allow);
        let payloads = requested_payloads(&f.captured);
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0]["warning"]["kind"], json!("security"));
        assert!(
            payloads[0]["escape"]["network"]
                .as_str()
                .is_some_and(|detail| detail.contains("example.com")),
            "{}",
            payloads[0]
        );
        // That one run gets the network; the session flag stays off.
        let delta = deltas.take(command, None).expect("network delta");
        assert!(delta.network && !delta.unsandboxed);
        assert!(!network.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn a_denied_flagged_egress_authorizes_nothing() {
        let deltas = ExecutionDeltas::default();
        let f = jailed_ask_fixture_with(
            Arc::new(AtomicBool::new(false)),
            std::env::temp_dir(),
            deltas.clone(),
        );
        let task = tokio::spawn({
            let gate = f.gate.clone();
            async move {
                gate.check("bash", &bash("curl https://example.com > $out"))
                    .await
            }
        });
        answer_when_prompted(&f.registry, &f.captured, ApprovalDecision::Deny, 0).await;
        assert!(matches!(task.await.unwrap(), CheckOutcome::Deny(_)));
        assert!(deltas.is_empty());
    }

    // ---- Reviews started with the model turn -----------------------------

    #[tokio::test]
    async fn a_turns_reviews_run_together_and_each_is_used_once() {
        let judge =
            ScriptedJudge::with_delay(vec![JUDGE_ALLOW, JUDGE_ALLOW], Duration::from_millis(400));
        let f = judged_fixture("conv-p1", judge);
        let calls = vec![
            ("bash".to_string(), bash("ls -la")),
            ("bash".to_string(), bash("git status")),
        ];
        let started = std::time::Instant::now();
        f.gate.prefetch_reviews(&calls);
        for (tool, args) in &calls {
            assert_eq!(
                f.gate.check_call(None, tool, args).await,
                CheckOutcome::Allow
            );
        }
        // Concurrent: well under two sequential 400ms reviews.
        assert!(
            started.elapsed() < Duration::from_millis(750),
            "{:?}",
            started.elapsed()
        );
        // Each prefetched review was used: no second round of calls.
        assert_eq!(f.judge.calls(), 2);
        // The second review saw the first call's input, as it would have
        // after the first call's decision.
        let seen = f.judge.seen.lock().unwrap().clone();
        let second = seen.iter().find(|p| p.contains("git status")).unwrap();
        assert!(second.contains("ls -la"), "{second}");
        settle_log().await;
    }

    #[tokio::test]
    async fn a_prefetch_whose_inputs_changed_is_reviewed_afresh() {
        let judge = ScriptedJudge::new(vec![JUDGE_ALLOW, JUDGE_ALLOW]);
        let f = judged_fixture("conv-p2", judge);
        let args = bash("ls -la");
        f.gate
            .prefetch_reviews(&[("bash".to_string(), args.clone())]);
        // The posture changes before the call is decided (MCP servers load
        // after the gate is built): the prefetched review is stale.
        f.session.set_mcp_servers(vec!["Context7".to_string()]);
        assert_eq!(
            f.gate.check_call(None, "bash", &args).await,
            CheckOutcome::Allow
        );
        // The deciding review saw the new posture (the stale one was
        // aborted, possibly before it ever reached the judge).
        let seen = f.judge.seen.lock().unwrap().clone();
        assert!(seen.last().unwrap().contains("Context7"), "{seen:?}");
        assert!(f.session.prefetched.lock().unwrap().is_empty());
        settle_log().await;
    }

    #[tokio::test]
    async fn calls_that_need_no_review_start_none() {
        let judge = ScriptedJudge::new(vec![]);
        let f = judged_fixture("conv-p3", judge);
        // Read-only tools never reach the judge.
        f.gate
            .prefetch_reviews(&[("read".to_string(), json!({ "path": "/tmp/x" }))]);
        assert!(f.session.prefetched.lock().unwrap().is_empty());
        assert_eq!(f.judge.calls(), 0);
    }
}
