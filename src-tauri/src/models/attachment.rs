use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ==========================================================================
// USER ATTACHMENTS (user-provided files)
// ==========================================================================

/// File attachment - stores metadata about a user-uploaded file
/// Content is stored in filesystem at storage_path
/// content_hash enables deduplication - same content shares storage
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FileAttachment {
    pub id: String,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub storage_path: String, // Path relative to attachments dir: "files/{hash}.pdf"
    pub content_hash: String, // Blake3 hash of file content
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFileAttachmentRequest {
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub storage_path: String,
    pub content_hash: String,
}

/// Unified user attachment enum for API responses
/// Currently only supports files; user-provided URLs are stored as fetch_results with source_type="user_link"
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UserAttachment {
    File(FileAttachment),
}

impl UserAttachment {
    pub fn id(&self) -> &str {
        match self {
            UserAttachment::File(f) => &f.id,
        }
    }
}
