//! Auxiliary model resolution.
//!
//! Two settings route cheap or vision-only work away from the conversation's
//! main model:
//!
//! - `aux_tiny_model_id` — lightweight model for auxiliary text work (title
//!   generation, compaction summaries). Always falls back to the
//!   conversation model.
//! - `aux_vision_model_id` — vision-capable model for image questions and
//!   image analysis. Falls back to the conversation model when it accepts
//!   image input, else the first configured model that does.
//!
//! Resolution never fails hard: callers receive a usable model (tiny) or
//! `None` (vision), and degrade to their existing behavior on `None`.

use super::AppState;

/// Setting key for the lightweight aux model.
const TINY_SETTING: &str = "aux_tiny_model_id";
/// Setting key for the vision aux model.
const VISION_SETTING: &str = "aux_vision_model_id";

/// A fully resolved model, ready for a one-shot provider call.
#[derive(Debug, Clone)]
pub(crate) struct AuxModel {
    pub provider_type: String,
    pub model_id: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub api_style: Option<String>,
}

/// The conversation's active model, used as the resolution fallback.
#[derive(Debug, Clone)]
pub(crate) struct ConversationModel {
    pub provider_type: String,
    pub model_id: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub api_style: Option<String>,
    /// `None` means unknown (treated optimistically as vision-capable,
    /// matching the capabilities convention).
    pub supports_vision: Option<bool>,
}

impl ConversationModel {
    fn as_aux(&self) -> AuxModel {
        AuxModel {
            provider_type: self.provider_type.clone(),
            model_id: self.model_id.clone(),
            api_key: self.api_key.clone(),
            base_url: self.base_url.clone(),
            api_style: self.api_style.clone(),
        }
    }
}

/// Resolve a settings-configured model to a callable form. `None` when the
/// setting is unset or the referenced model/provider rows are gone (stale
/// setting, pruned provider) — callers fall back.
async fn model_from_setting(state: &AppState, setting: &str) -> Option<AuxModel> {
    let model_row_id = state.db.get_setting(setting).await.ok().flatten()?;
    let model = state.db.get_model(&model_row_id).await.ok()??;
    let provider = state.db.get_provider(&model.provider_id).await.ok()??;
    Some(AuxModel {
        provider_type: provider.provider_type,
        model_id: model.model_id,
        api_key: provider.api_key,
        base_url: provider.base_url,
        api_style: provider.api_style,
    })
}

/// Resolve the lightweight aux model. Always returns something: the
/// configured model when valid, else the conversation model.
pub(crate) async fn resolve_aux_tiny(
    state: &AppState,
    conversation: &ConversationModel,
) -> AuxModel {
    if let Some(aux) = model_from_setting(state, TINY_SETTING).await {
        tracing::info!(
            "🪶 [aux_model] tiny: configured {} / {}",
            aux.provider_type,
            aux.model_id
        );
        return aux;
    }
    tracing::info!(
        "🪶 [aux_model] tiny: no valid setting, using conversation model {} / {}",
        conversation.provider_type,
        conversation.model_id
    );
    conversation.as_aux()
}

/// Resolve the vision aux model. Order: configured setting → conversation
/// model (when it accepts image input) → first configured model that does.
/// `None` means no vision-capable model is available.
pub(crate) async fn resolve_aux_vision(
    state: &AppState,
    conversation: &ConversationModel,
) -> Option<AuxModel> {
    if let Some(aux) = model_from_setting(state, VISION_SETTING).await {
        tracing::info!(
            "👁️ [aux_model] vision: configured {} / {}",
            aux.provider_type,
            aux.model_id
        );
        return Some(aux);
    }
    if conversation.supports_vision != Some(false) {
        tracing::info!(
            "👁️ [aux_model] vision: conversation model {} / {} accepts image input",
            conversation.provider_type,
            conversation.model_id
        );
        return Some(conversation.as_aux());
    }
    // The conversation model is confirmed text-only: scan configured models
    // for one that accepts image input (unknown capabilities count as
    // capable; a provider rejection degrades at call time).
    let models = state.db.list_models().await.unwrap_or_default();
    for model in models {
        let Ok(Some(provider)) = state.db.get_provider(&model.provider_id).await else {
            continue;
        };
        let capabilities = state
            .capabilities_cache
            .resolve(&provider.provider_type, &model.model_id)
            .await;
        if capabilities.supports_vision != Some(false) {
            tracing::info!(
                "👁️ [aux_model] vision: conversation model is text-only, using {} / {}",
                provider.provider_type,
                model.model_id
            );
            return Some(AuxModel {
                provider_type: provider.provider_type,
                model_id: model.model_id,
                api_key: provider.api_key,
                base_url: provider.base_url,
                api_style: provider.api_style,
            });
        }
    }
    tracing::info!("👁️ [aux_model] vision: no vision-capable model configured");
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_model_fallback_shape() {
        // The fallback clone must carry every call field.
        let conversation = ConversationModel {
            provider_type: "openai".into(),
            model_id: "gpt-test".into(),
            api_key: Some("key".into()),
            base_url: Some("https://example.invalid".into()),
            api_style: Some("openai".into()),
            supports_vision: Some(true),
        };
        let aux = conversation.as_aux();
        assert_eq!(aux.provider_type, "openai");
        assert_eq!(aux.model_id, "gpt-test");
        assert_eq!(aux.api_key.as_deref(), Some("key"));
    }
}
