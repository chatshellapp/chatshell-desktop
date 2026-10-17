use serde::Deserialize;

/// File attachment data from frontend
#[derive(Debug, Clone, Deserialize)]
pub struct FileAttachmentInput {
    pub name: String,
    /// Text content for text-ish files. Empty when `base64` is supplied.
    #[serde(default)]
    pub content: String,
    /// Raw bytes as standard base64, for binary documents (Office). Mutually
    /// exclusive with `content`; binary files never pass through UTF-8.
    #[serde(default)]
    pub base64: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

/// Image attachment data from frontend
#[derive(Debug, Clone, Deserialize)]
pub struct ImageAttachmentInput {
    pub name: String,
    pub base64: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

/// Parameter overrides from conversation settings
#[derive(Debug, Clone, Deserialize)]
pub struct ParameterOverrides {
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
}
