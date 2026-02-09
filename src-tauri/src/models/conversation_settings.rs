use serde::{Deserialize, Deserializer, Serialize};

/// Prompt mode for system/user prompts
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PromptMode {
    /// No override - use assistant's default prompt
    #[default]
    None,
    /// Use a selected existing prompt from the prompts table
    Existing,
    /// Use custom content
    Custom,
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

/// Custom deserializer for `Option<Option<T>>` fields in update requests.
///
/// By default, serde treats JSON `null` as `None` for the outer Option (= "field not provided"),
/// making it impossible to distinguish between "field absent" and "field explicitly set to null".
/// This deserializer ensures:
/// - Field absent in JSON → `None` (via `#[serde(default)]`)
/// - Field present with `null` → `Some(None)` (= "clear the value")
/// - Field present with value → `Some(Some(value))` (= "set to this value")
fn deserialize_double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
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

    /// Enabled MCP server IDs for this conversation (JSON array)
    #[serde(default)]
    pub enabled_mcp_server_ids: Vec<String>,

    /// Enabled skill IDs for this conversation (JSON array)
    #[serde(default)]
    pub enabled_skill_ids: Vec<String>,

    /// Working directory for bash tool (overrides default home directory)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
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
            enabled_mcp_server_ids: Vec::new(),
            enabled_skill_ids: Vec::new(),
            working_directory: None,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled_mcp_server_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled_skill_ids: Option<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_double_option"
    )]
    pub working_directory: Option<Option<String>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prompt_mode_default() {
        assert_eq!(PromptMode::default(), PromptMode::None);
    }

    #[test]
    fn test_prompt_mode_from_str() {
        assert_eq!(PromptMode::from("none"), PromptMode::None);
        assert_eq!(PromptMode::from("existing"), PromptMode::Existing);
        assert_eq!(PromptMode::from("custom"), PromptMode::Custom);
        assert_eq!(PromptMode::from("unknown"), PromptMode::None);
        assert_eq!(PromptMode::from(""), PromptMode::None);
    }

    #[test]
    fn test_prompt_mode_to_string() {
        assert_eq!(String::from(PromptMode::None), "none");
        assert_eq!(String::from(PromptMode::Existing), "existing");
        assert_eq!(String::from(PromptMode::Custom), "custom");
    }

    #[test]
    fn test_model_parameter_overrides_default() {
        let overrides = ModelParameterOverrides::default();
        assert!(overrides.temperature.is_none());
        assert!(overrides.max_tokens.is_none());
        assert!(overrides.top_p.is_none());
        assert!(overrides.frequency_penalty.is_none());
        assert!(overrides.presence_penalty.is_none());
    }

    #[test]
    fn test_conversation_settings_default_for_conversation() {
        let settings = ConversationSettings::default_for_conversation("conv-123".to_string());

        assert_eq!(settings.conversation_id, "conv-123");
        assert!(settings.use_provider_defaults);
        assert!(!settings.use_custom_parameters);
        assert!(settings.context_message_count.is_none());
        assert!(settings.selected_preset_id.is_none());
        assert_eq!(settings.system_prompt_mode, PromptMode::None);
        assert!(settings.selected_system_prompt_id.is_none());
        assert!(settings.custom_system_prompt.is_none());
        assert_eq!(settings.user_prompt_mode, PromptMode::None);
        assert!(settings.selected_user_prompt_id.is_none());
        assert!(settings.custom_user_prompt.is_none());
        assert!(settings.enabled_mcp_server_ids.is_empty());
        assert!(settings.enabled_skill_ids.is_empty());
        assert!(settings.working_directory.is_none());
    }

    #[test]
    fn test_conversation_settings_serialization() {
        let settings = ConversationSettings::default_for_conversation("conv-456".to_string());
        let json = serde_json::to_string(&settings).unwrap();

        assert!(json.contains(r#""conversation_id":"conv-456""#));
        assert!(json.contains(r#""use_provider_defaults":true"#));
    }

    #[test]
    fn test_working_directory_deserialization_null_clears_value() {
        // When frontend sends { "working_directory": null }, it should deserialize as Some(None)
        // meaning "clear the value", NOT None meaning "field not provided"
        let json = r#"{"working_directory": null}"#;
        let req: UpdateConversationSettingsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.working_directory, Some(None));
    }

    #[test]
    fn test_working_directory_deserialization_absent_means_not_provided() {
        // When field is absent, it should be None (don't change)
        let json = r#"{}"#;
        let req: UpdateConversationSettingsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.working_directory, None);
    }

    #[test]
    fn test_working_directory_deserialization_value_sets_value() {
        // When field has a string value, it should be Some(Some("path"))
        let json = r#"{"working_directory": "/tmp/test"}"#;
        let req: UpdateConversationSettingsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.working_directory, Some(Some("/tmp/test".to_string())));
    }

    #[test]
    fn test_model_parameter_overrides_serialization() {
        let overrides = ModelParameterOverrides {
            temperature: Some(0.7),
            max_tokens: Some(4096),
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
        };
        let json = serde_json::to_string(&overrides).unwrap();

        // Should include set values
        assert!(json.contains(r#""temperature":0.7"#));
        assert!(json.contains(r#""max_tokens":4096"#));
        // Should skip None values
        assert!(!json.contains("top_p"));
        assert!(!json.contains("frequency_penalty"));
    }
}
