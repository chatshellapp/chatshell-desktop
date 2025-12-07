use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ==========================================================================
// USER ATTACHMENTS (user-provided files and links)
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

/// User link - stores URL explicitly shared by user (not from search)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserLink {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserLinkRequest {
    pub url: String,
    pub title: Option<String>,
}

/// User attachment type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UserAttachmentType {
    File,
    UserLink,
}

impl std::fmt::Display for UserAttachmentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserAttachmentType::File => write!(f, "file"),
            UserAttachmentType::UserLink => write!(f, "user_link"),
        }
    }
}

impl std::str::FromStr for UserAttachmentType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "file" => Ok(UserAttachmentType::File),
            "user_link" => Ok(UserAttachmentType::UserLink),
            _ => Err(format!("Invalid user attachment type: {}", s)),
        }
    }
}

/// Unified user attachment enum for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UserAttachment {
    File(FileAttachment),
    UserLink(UserLink),
}

impl UserAttachment {
    pub fn id(&self) -> &str {
        match self {
            UserAttachment::File(f) => &f.id,
            UserAttachment::UserLink(l) => &l.id,
        }
    }

    pub fn attachment_type(&self) -> UserAttachmentType {
        match self {
            UserAttachment::File(_) => UserAttachmentType::File,
            UserAttachment::UserLink(_) => UserAttachmentType::UserLink,
        }
    }
}

