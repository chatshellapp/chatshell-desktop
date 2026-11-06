//! Desktop host of the auto-mode judge (permission v3, Phase B).
//!
//! The engine, ruleset, verdict contract, counters, and capability probe
//! live in `chatshell_agent_core::judgment`; this module supplies what
//! needs the desktop: the provider call ([`ProviderJudge`], one
//! non-streamed completion through the same provider routing as chat, so
//! Anthropic models get their `cache_control` breakpoint on the byte-
//! stable ruleset), provider-error classification, the classifier-model
//! setting, and the device-local stores.
//!
//! Wiring into the permission gate is Phase C; nothing here prompts or
//! touches the UI.

// Phase C (AR-13) routes the gate's `Classify` decisions through this
// module; until then its entry points are exercised by tests only.
#![allow(dead_code)]

use super::agent_builder::{AgentConfig, build_user_message, create_provider_agent};
use crate::commands::AppState;
use crate::commands::chat::aux_models::{AuxModel, ConversationModel};
use chatshell_agent_core::judgment::engine::{
    DenialCounters, EligibilityCache, JudgeCall, JudgeError, JudgeModel,
};
use chatshell_agent_core::judgment::log::{DecisionLog, LOG_FILE_NAME};
use futures::future::BoxFuture;
use std::sync::{LazyLock, OnceLock};

/// Setting key of the optional dedicated classifier model (a model row
/// id). Unset or stale: the conversation model judges.
pub const CLASSIFIER_MODEL_SETTING: &str = "auto_review_model_id";

/// Probe results for this run of the app (cleared on restart).
static ELIGIBILITY: LazyLock<EligibilityCache> = LazyLock::new(EligibilityCache::default);

/// Denial counters per conversation (RAM only).
static DENIALS: LazyLock<DenialCounters> = LazyLock::new(DenialCounters::default);

/// The device-local decision log, set once at startup.
static DECISION_LOG: OnceLock<DecisionLog> = OnceLock::new();

/// Point the decision log at its file in the app data directory. Called
/// from `init_device_stores`; later calls are ignored. The file is never
/// part of the synced database.
pub fn init_decision_log(app_data_dir: &std::path::Path) {
    let _ = DECISION_LOG.set(DecisionLog::new(app_data_dir.join(LOG_FILE_NAME)));
}

pub fn decision_log() -> Option<&'static DecisionLog> {
    DECISION_LOG.get()
}

pub fn eligibility_cache() -> &'static EligibilityCache {
    &ELIGIBILITY
}

pub fn denial_counters() -> &'static DenialCounters {
    &DENIALS
}

/// A model reachable for one-shot judge calls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderJudge {
    pub provider_type: String,
    pub model_id: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub api_style: Option<String>,
}

impl From<AuxModel> for ProviderJudge {
    fn from(model: AuxModel) -> Self {
        Self {
            provider_type: model.provider_type,
            model_id: model.model_id,
            api_key: model.api_key,
            base_url: model.base_url,
            api_style: model.api_style,
        }
    }
}

impl ProviderJudge {
    /// The eligibility cache key for this model.
    pub fn cache_key(&self) -> String {
        EligibilityCache::key(
            &self.provider_type,
            &self.model_id,
            self.base_url.as_deref(),
        )
    }

    /// The agent config of one judge call: the ruleset as system prompt,
    /// no tools, temperature and output bound from the call.
    pub(crate) fn agent_config(call: &JudgeCall<'_>) -> AgentConfig {
        let mut config = AgentConfig::new()
            .with_system_prompt(call.system)
            .with_max_tokens(i64::from(call.max_tokens));
        if let Some(temperature) = call.temperature {
            config = config.with_temperature(temperature);
        }
        config
    }
}

impl JudgeModel for ProviderJudge {
    fn label(&self) -> String {
        format!("{}/{}", self.provider_type, self.model_id)
    }

    fn complete<'a>(&'a self, call: JudgeCall<'a>) -> BoxFuture<'a, Result<String, JudgeError>> {
        Box::pin(async move {
            let config = Self::agent_config(&call);
            let agent = create_provider_agent(
                &self.provider_type,
                &self.model_id,
                self.api_key.as_deref(),
                self.base_url.as_deref(),
                self.api_style.as_deref(),
                &config,
            )
            .map_err(|err| JudgeError::Permanent(format!("{err:#}")))?;
            let prompt = build_user_message(call.user, &[], &[]);
            let cancel = call.cancel.clone();
            let response = super::stream_chat_with_agent(
                agent,
                prompt,
                Vec::new(),
                cancel.clone(),
                |_, _| true,
                &self.provider_type,
            )
            .await;
            if cancel.is_cancelled() {
                return Err(JudgeError::Cancelled);
            }
            match response {
                Ok(response) => match response.interrupted {
                    // A stream that broke mid-answer: the verdict may be cut.
                    Some(error) => Err(classify_provider_error(&error)),
                    None => Ok(response.content),
                },
                Err(err) => Err(classify_provider_error(&format!("{err:#}"))),
            }
        })
    }
}

/// Sort a provider error into retry-worthy or not. Transient: rate
/// limits, overload, 5xx, timeouts, and network failures; everything else
/// (auth, bad request, unsupported parameter, unknown model) is permanent.
pub fn classify_provider_error(message: &str) -> JudgeError {
    let lower = message.to_ascii_lowercase();
    let transient_markers = [
        "429",
        "rate limit",
        "rate_limit",
        "too many requests",
        "overloaded",
        "529",
        "500",
        "502",
        "503",
        "504",
        "internal server error",
        "bad gateway",
        "service unavailable",
        "gateway timeout",
        "timed out",
        "timeout",
        "connection",
        "connect error",
        "dns",
        "network",
        "temporarily",
    ];
    if transient_markers
        .iter()
        .any(|marker| lower.contains(marker))
    {
        JudgeError::Transient(message.to_string())
    } else {
        JudgeError::Permanent(message.to_string())
    }
}

/// Resolve the classifier model: the configured dedicated model when the
/// setting names a usable model, else the conversation model (AR-10).
/// The capability gate applies to whichever is returned.
pub(crate) async fn resolve_classifier_model(
    state: &AppState,
    conversation: &ConversationModel,
) -> ProviderJudge {
    if let Some(model) = configured_classifier_model(state).await {
        tracing::info!(
            "🛡️ [auto_review] classifier: configured {} / {}",
            model.provider_type,
            model.model_id
        );
        return model;
    }
    ProviderJudge {
        provider_type: conversation.provider_type.clone(),
        model_id: conversation.model_id.clone(),
        api_key: conversation.api_key.clone(),
        base_url: conversation.base_url.clone(),
        api_style: conversation.api_style.clone(),
    }
}

/// The dedicated classifier model, when the setting names a model row
/// whose provider still exists. `None` on unset, stale, or unreadable.
pub(crate) async fn configured_classifier_model(state: &AppState) -> Option<ProviderJudge> {
    crate::commands::chat::aux_models::model_from_setting(state, CLASSIFIER_MODEL_SETTING)
        .await
        .map(ProviderJudge::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::RwLock;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn provider_errors_are_classified() {
        for transient in [
            "HTTP 429 Too Many Requests",
            "Provider returned 503 Service Unavailable",
            "anthropic: overloaded_error",
            "request timed out",
            "error sending request: connection refused",
            "rate_limit_error: slow down",
        ] {
            assert!(
                matches!(classify_provider_error(transient), JudgeError::Transient(_)),
                "{transient}"
            );
        }
        for permanent in [
            "401 Unauthorized: invalid x-api-key",
            "400 Unsupported value: 'temperature' does not support 0",
            "model not found: gpt-nope",
        ] {
            assert!(
                matches!(classify_provider_error(permanent), JudgeError::Permanent(_)),
                "{permanent}"
            );
        }
    }

    #[test]
    fn judge_calls_use_temperature_zero_and_the_output_bound() {
        let call = JudgeCall {
            system: "rules",
            user: "action",
            temperature: Some(0.0),
            max_tokens: 256,
            cancel: CancellationToken::new(),
        };
        let config = ProviderJudge::agent_config(&call);
        assert_eq!(config.system_prompt.as_deref(), Some("rules"));
        assert_eq!(config.model_params.temperature, Some(0.0));
        assert_eq!(config.model_params.max_tokens, Some(256));
        assert!(!config.enable_bash && !config.enable_web_fetch && !config.enable_read);
        // Models that reject the parameter get none at all.
        let call = JudgeCall {
            temperature: None,
            ..call
        };
        assert_eq!(
            ProviderJudge::agent_config(&call).model_params.temperature,
            None
        );
    }

    #[test]
    fn cache_keys_separate_endpoints() {
        let judge = ProviderJudge {
            provider_type: "openai".into(),
            model_id: "gpt-x".into(),
            api_key: None,
            base_url: None,
            api_style: None,
        };
        let proxied = ProviderJudge {
            base_url: Some("https://proxy.example".into()),
            ..judge.clone()
        };
        assert_ne!(judge.cache_key(), proxied.cache_key());
        assert_eq!(judge.label(), "openai/gpt-x");
    }

    async fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        let state = AppState {
            db,
            generation_tasks: Arc::new(RwLock::new(HashMap::new())),
            mcp_manager: Arc::new(crate::mcp::McpConnectionManager::new()),
            pending_oauth: Arc::new(RwLock::new(HashMap::new())),
            bash_session_manager: Arc::new(crate::llm::tools::BashSessionManager::new()),
            capabilities_cache: Arc::new(crate::llm::capabilities::CapabilitiesCache::new()),
            sync_engine: Arc::new(std::sync::Mutex::new(None)),
            approval_registry: crate::llm::permission::ApprovalRegistry::new(),
            permission_grants: Arc::new(std::sync::Mutex::new(HashMap::new())),
        };
        (state, dir)
    }

    fn conversation_model() -> ConversationModel {
        ConversationModel {
            provider_type: "anthropic".into(),
            model_id: "claude-conversation".into(),
            api_key: Some("conv-key".into()),
            base_url: None,
            api_style: None,
            supports_vision: Some(true),
        }
    }

    #[tokio::test]
    async fn classifier_model_setting_round_trips_and_falls_back() {
        let (state, _dir) = test_state().await;
        let conversation = conversation_model();
        // Unset: the conversation model judges.
        let judge = resolve_classifier_model(&state, &conversation).await;
        assert_eq!(judge.model_id, "claude-conversation");
        assert_eq!(judge.api_key.as_deref(), Some("conv-key"));

        // A configured model wins.
        let provider = state
            .db
            .create_provider(crate::models::CreateProviderRequest {
                name: "OpenAI".into(),
                provider_type: "openai".into(),
                api_key: Some("judge-key".into()),
                base_url: None,
                description: None,
                is_enabled: Some(true),
                api_style: None,
            })
            .await
            .unwrap();
        let model = state
            .db
            .create_model(crate::models::CreateModelRequest {
                name: "Judge".into(),
                provider_id: provider.id.clone(),
                model_id: "gpt-judge".into(),
                description: None,
                is_starred: None,
            })
            .await
            .unwrap();
        state
            .db
            .set_setting(CLASSIFIER_MODEL_SETTING, &model.id)
            .await
            .unwrap();
        assert_eq!(
            state
                .db
                .get_setting(CLASSIFIER_MODEL_SETTING)
                .await
                .unwrap()
                .as_deref(),
            Some(model.id.as_str())
        );
        let judge = resolve_classifier_model(&state, &conversation).await;
        assert_eq!(judge.provider_type, "openai");
        assert_eq!(judge.model_id, "gpt-judge");
        assert_eq!(judge.api_key.as_deref(), Some("judge-key"));

        // A stale or invalid value falls back to the conversation model.
        state
            .db
            .set_setting(CLASSIFIER_MODEL_SETTING, "no-such-model")
            .await
            .unwrap();
        let judge = resolve_classifier_model(&state, &conversation).await;
        assert_eq!(judge.model_id, "claude-conversation");
    }

    #[test]
    fn decision_log_lives_outside_the_synced_database() {
        let dir = tempfile::tempdir().unwrap();
        init_decision_log(dir.path());
        let log = decision_log().expect("initialized");
        // Its own file, never the canonical database (`data.db`) that the
        // sync snapshot copies with `VACUUM INTO`.
        let name = log.path().file_name().unwrap().to_str().unwrap();
        assert_eq!(name, LOG_FILE_NAME);
        assert_ne!(name, "data.db");
    }
}
