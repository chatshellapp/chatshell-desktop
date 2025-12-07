use serde::Deserialize;

/// File attachment data from frontend
#[derive(Debug, Clone, Deserialize)]
pub struct FileAttachmentInput {
    pub name: String,
    pub content: String,
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

