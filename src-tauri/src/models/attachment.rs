use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

// ==========================================================================
// USER ATTACHMENTS (user-provided files)
// ==========================================================================

/// File attachment - stores metadata about a user-uploaded file
/// Content is stored in filesystem at storage_path
/// content_hash enables deduplication - same content shares storage
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct FileAttachment {
    pub id: String,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub storage_path: String, // Path relative to attachments dir: "files/{hash}.pdf"
    pub content_hash: String, // Blake3 hash of file content
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateFileAttachmentRequest {
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub storage_path: String,
    pub content_hash: String,
}

/// Per-attachment result of a fetch-on-open blob pass (`fetch_conversation_blobs`).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct BlobFetchStatus {
    pub content_hash: String,
    /// One of: cached (bytes already local), fetched (materialized this
    /// pass), gone (no device in the container holds the bytes), skipped
    /// (outside the fetch-on-open budget; still fetchable on demand).
    pub status: String,
}

/// Unified user attachment enum for API responses
/// Currently only supports files; user-provided URLs are stored as fetch_results with source_type="user_link"
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
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
