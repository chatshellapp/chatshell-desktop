use serde::{Deserialize, Serialize};

/// Prompt mode for system/user prompts
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PromptMode {
    /// No override - use assistant's default prompt
    None,
    /// Use a selected existing prompt from the prompts table
    Existing,
    /// Use custom content
    Custom,
}

impl Default for PromptMode {
    fn default() -> Self {
        Self::None
    }
}

impl From<&str> for PromptMode {
    fn from(s: &str) -> Self {
        match s {
            "existing" => Self::Existing,
            "custom" => Self::Custom,
            _ => Self::None,
        }
    }
}

impl From<PromptMode> for String {
    fn from(mode: PromptMode) -> Self {
        match mode {
            PromptMode::None => "none".to_string(),
            PromptMode::Existing => "existing".to_string(),
            PromptMode::Custom => "custom".to_string(),
        }
    }
}

/// Model parameter overrides for a conversation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelParameterOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f64>,
}

/// Conversation-level settings that override assistant defaults
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSettings {
    pub conversation_id: String,

    /// When true, no parameters are sent to API (use provider defaults)
    pub use_provider_defaults: bool,

    /// When true, use custom parameter overrides
    pub use_custom_parameters: bool,

    /// Custom parameter overrides
    pub parameter_overrides: ModelParameterOverrides,

    /// Max number of context messages to include (null = unlimited)
    pub context_message_count: Option<i32>,

    /// Selected preset ID for UI display
    pub selected_preset_id: Option<String>,

    /// System prompt mode
    pub system_prompt_mode: PromptMode,

    /// Selected system prompt ID (when mode is 'existing')
    pub selected_system_prompt_id: Option<String>,

    /// Custom system prompt content (when mode is 'custom')
    pub custom_system_prompt: Option<String>,

    /// User prompt mode
    pub user_prompt_mode: PromptMode,

    /// Selected user prompt ID (when mode is 'existing')
    pub selected_user_prompt_id: Option<String>,

    /// Custom user prompt content (when mode is 'custom')
    pub custom_user_prompt: Option<String>,
}

impl ConversationSettings {
    /// Create default settings for a conversation
    pub fn default_for_conversation(conversation_id: String) -> Self {
        Self {
            conversation_id,
            use_provider_defaults: true,
            use_custom_parameters: false,
            parameter_overrides: ModelParameterOverrides::default(),
            context_message_count: None,
            selected_preset_id: None,
            system_prompt_mode: PromptMode::None,
            selected_system_prompt_id: None,
            custom_system_prompt: None,
            user_prompt_mode: PromptMode::None,
            selected_user_prompt_id: None,
            custom_user_prompt: None,
        }
    }
}

/// Request to update conversation settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateConversationSettingsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_provider_defaults: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_custom_parameters: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_overrides: Option<ModelParameterOverrides>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_message_count: Option<Option<i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_preset_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt_mode: Option<PromptMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_system_prompt_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_system_prompt: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_prompt_mode: Option<PromptMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_user_prompt_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_user_prompt: Option<Option<String>>,
}
