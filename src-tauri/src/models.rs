use serde::{Deserialize, Serialize};

// Provider models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,          // Display name, e.g., "Ollama Local", "OpenAI"
    pub provider_type: String, // Type: ollama, openai, openrouter
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub description: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProviderRequest {
    pub name: String,
    pub provider_type: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub description: Option<String>,
    pub is_enabled: Option<bool>,
}

// Model (LLM) models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub name: String,        // Display name, e.g., "DeepSeek R1 14B"
    pub provider_id: String, // Foreign key to providers table
    pub model_id: String,    // Actual model identifier, e.g., "deepseek-r1:14b"
    pub description: Option<String>,
    pub is_starred: bool,  // Whether model is starred for quick access
    pub is_deleted: bool,  // Soft delete flag
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateModelRequest {
    pub name: String,
    pub provider_id: String,
    pub model_id: String,
    pub description: Option<String>,
    pub is_starred: Option<bool>,
}

// Assistant models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assistant {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub description: Option<String>,
    pub system_prompt: String,
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    // Avatar fields
    pub avatar_type: String,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,

    pub group_name: Option<String>,
    pub is_starred: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAssistantRequest {
    pub name: String,
    pub role: Option<String>,
    pub description: Option<String>,
    pub system_prompt: String,
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    pub avatar_type: Option<String>,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,

    pub group_name: Option<String>,
    pub is_starred: Option<bool>,
}

// Knowledge Base models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeBase {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub content: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKnowledgeBaseRequest {
    pub name: String,
    pub r#type: String,
    pub content: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<String>,
}

// Tool models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub endpoint: Option<String>,
    pub config: Option<String>,
    pub description: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateToolRequest {
    pub name: String,
    pub r#type: String,
    pub endpoint: Option<String>,
    pub config: Option<String>,
    pub description: Option<String>,
    pub is_enabled: Option<bool>,
}

// User models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_type: String,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,
    pub is_self: bool,
    pub status: String,
    pub last_seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_type: Option<String>,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,
    pub is_self: Option<bool>,
}

// User relationship models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRelationship {
    pub id: String,
    pub user_id: String,
    pub related_user_id: String,
    pub relationship_type: String, // "friend", "blocked", "pending"
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRelationshipRequest {
    pub user_id: String,
    pub related_user_id: String,
    pub relationship_type: String,
}

// Conversation models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConversationRequest {
    pub title: String,
}

// Conversation participant models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationParticipant {
    pub id: String,
    pub conversation_id: String,
    pub participant_type: String, // "user", "model", "assistant"
    pub participant_id: Option<String>,
    pub display_name: Option<String>,
    pub role: String,   // "owner", "admin", "member", "observer"
    pub status: String, // "active", "left", "removed", "invited"
    pub joined_at: String,
    pub left_at: Option<String>,
    pub last_read_at: Option<String>,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConversationParticipantRequest {
    pub conversation_id: String,
    pub participant_type: String,
    pub participant_id: Option<String>,
    pub display_name: Option<String>,
}

// Participant summary for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantSummary {
    pub participant_type: String,
    pub participant_id: Option<String>,
    pub display_name: String,
    pub avatar_type: String,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,
}

// Message models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: Option<String>,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub content: String,
    pub thinking_content: Option<String>,
    pub tokens: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMessageRequest {
    pub conversation_id: Option<String>,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub content: String,
    pub thinking_content: Option<String>,
    pub tokens: Option<i64>,
}

// ========== Attachment Models (Split Tables) ==========

/// Search result - stores metadata about a web search operation
/// Content is not stored in filesystem, only metadata in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub query: String,
    pub engine: String, // "google" | "bing" | "duckduckgo"
    pub total_results: Option<i64>,
    pub searched_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSearchResultRequest {
    pub query: String,
    pub engine: String,
    pub total_results: Option<i64>,
    pub searched_at: String,
}

/// Fetch result - stores metadata about a fetched web resource
/// Content is stored in filesystem at storage_path
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchResult {
    pub id: String,
    pub search_id: Option<String>, // FK to search_results (NULL if standalone fetch)
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub storage_path: String, // Path relative to attachments dir: "fetch/{uuid}.md"
    pub content_type: String, // MIME type of stored content: "text/markdown", "text/plain"
    pub original_mime: Option<String>, // Original MIME type from HTTP response
    pub status: String,       // "pending" | "processing" | "success" | "failed"
    pub error: Option<String>,
    pub keywords: Option<String>,
    pub headings: Option<String>, // JSON array of headings
    pub original_size: Option<i64>,
    pub processed_size: Option<i64>,
    pub favicon_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFetchResultRequest {
    pub search_id: Option<String>,
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub storage_path: String,
    pub content_type: String,
    pub original_mime: Option<String>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub keywords: Option<String>,
    pub headings: Option<String>,
    pub original_size: Option<i64>,
    pub processed_size: Option<i64>,
    pub favicon_url: Option<String>,
}

/// File attachment - stores metadata about a user-uploaded file
/// Content is stored in filesystem at storage_path
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAttachment {
    pub id: String,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub storage_path: String, // Path relative to attachments dir: "files/{uuid}.pdf"
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFileAttachmentRequest {
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub storage_path: String,
}

/// Search decision - stores AI's reasoning about whether web search is needed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDecision {
    pub id: String,
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSearchDecisionRequest {
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
}

/// Attachment type enum for polymorphic handling
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentType {
    SearchResult,
    FetchResult,
    File,
    SearchDecision,
}

impl std::fmt::Display for AttachmentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AttachmentType::SearchResult => write!(f, "search_result"),
            AttachmentType::FetchResult => write!(f, "fetch_result"),
            AttachmentType::File => write!(f, "file"),
            AttachmentType::SearchDecision => write!(f, "search_decision"),
        }
    }
}

impl std::str::FromStr for AttachmentType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "search_result" => Ok(AttachmentType::SearchResult),
            "fetch_result" => Ok(AttachmentType::FetchResult),
            "file" => Ok(AttachmentType::File),
            "search_decision" => Ok(AttachmentType::SearchDecision),
            _ => Err(format!("Invalid attachment type: {}", s)),
        }
    }
}

/// Message attachment link - polymorphic junction table record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageAttachment {
    pub id: String,
    pub message_id: String,
    pub attachment_type: AttachmentType,
    pub attachment_id: String,
    pub display_order: i32,
    pub created_at: String,
}

/// Unified attachment enum for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Attachment {
    SearchResult(SearchResult),
    FetchResult(FetchResult),
    File(FileAttachment),
    SearchDecision(SearchDecision),
}

impl Attachment {
    pub fn id(&self) -> &str {
        match self {
            Attachment::SearchResult(s) => &s.id,
            Attachment::FetchResult(f) => &f.id,
            Attachment::File(f) => &f.id,
            Attachment::SearchDecision(d) => &d.id,
        }
    }

    pub fn attachment_type(&self) -> AttachmentType {
        match self {
            Attachment::SearchResult(_) => AttachmentType::SearchResult,
            Attachment::FetchResult(_) => AttachmentType::FetchResult,
            Attachment::File(_) => AttachmentType::File,
            Attachment::SearchDecision(_) => AttachmentType::SearchDecision,
        }
    }
}

// Prompt models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub id: String,
    pub name: String,
    pub content: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_system: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePromptRequest {
    pub name: String,
    pub content: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_system: Option<bool>,
}

// Settings model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}
