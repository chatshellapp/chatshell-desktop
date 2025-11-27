pub mod common;
pub mod models;
pub mod ollama;
pub mod openai;
pub mod openrouter;

use serde::{Deserialize, Serialize};

/// Image data for multimodal messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageData {
    /// Base64 encoded image data (without data URL prefix)
    pub base64: String,
    /// MIME type (e.g., "image/png", "image/jpeg")
    pub media_type: String,
}

/// File/document data for multimodal messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileData {
    /// File name
    pub name: String,
    /// File content (text)
    pub content: String,
    /// MIME type (e.g., "text/plain", "text/markdown")
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Optional images for multimodal messages
    #[serde(default)]
    pub images: Vec<ImageData>,
    /// Optional files/documents for multimodal messages
    #[serde(default)]
    pub files: Vec<FileData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub thinking_content: Option<String>,
    pub tokens: Option<i64>,
}

