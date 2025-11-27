use serde::{Deserialize, Serialize};

// Provider models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,           // Display name, e.g., "Ollama Local", "OpenAI"
    pub provider_type: String,  // Type: ollama, openai, openrouter
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
    pub name: String,           // Display name, e.g., "DeepSeek R1 14B"
    pub provider_id: String,    // Foreign key to providers table
    pub model_id: String,       // Actual model identifier, e.g., "deepseek-r1:14b"
    pub description: Option<String>,
    pub is_starred: bool,       // Whether model is starred for quick access
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
    pub model_id: String,       // Foreign key to models table
    
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
    pub model_id: String,       // Foreign key to models table
    
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
    pub relationship_type: String,  // "friend", "blocked", "pending"
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
    pub participant_type: String,  // "user", "model", "assistant"
    pub participant_id: Option<String>,
    pub display_name: Option<String>,
    pub role: String,              // "owner", "admin", "member", "observer"
    pub status: String,            // "active", "left", "removed", "invited"
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

// Attachment models
// origin: "web" | "local"
// attachment_type: "fetch_result" | "search_result" | "file"
// content_format: MIME type (e.g., "text/html", "image/png", "application/pdf")
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub origin: String,              // "web" | "local"
    pub attachment_type: String,     // "fetch_result" | "search_result" | "file"
    pub content_format: Option<String>, // MIME type of extracted/converted content
    pub url: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,   // Original MIME type from source
    pub title: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,     // Extracted text content
    pub thumbnail_path: Option<String>,
    pub extraction_status: String,   // "pending" | "processing" | "success" | "failed"
    pub extraction_error: Option<String>,
    pub metadata: Option<String>,    // JSON metadata
    pub parent_id: Option<String>,   // For search_result children
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAttachmentRequest {
    pub origin: String,
    pub attachment_type: String,
    pub content_format: Option<String>,
    pub url: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub thumbnail_path: Option<String>,
    pub extraction_status: Option<String>,
    pub extraction_error: Option<String>,
    pub metadata: Option<String>,
    pub parent_id: Option<String>,
}

/// Metadata for web fetch results (stored as JSON in metadata field)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebFetchMetadata {
    pub keywords: Option<String>,
    pub headings: Vec<String>,
    pub fetched_at: String,
    pub original_length: Option<usize>,
    pub truncated: bool,
    pub favicon_url: Option<String>,
}

/// Metadata for web search results (stored as JSON in metadata field)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchMetadata {
    pub query: String,
    pub search_engine: String,       // "google" | "bing" | "duckduckgo" etc.
    pub total_results: Option<i64>,
    pub searched_at: String,
}

/// Metadata for local files (stored as JSON in metadata field)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFileMetadata {
    pub original_path: Option<String>,
    pub last_modified: Option<String>,
    pub page_count: Option<i32>,     // For PDF/Office documents
    pub dimensions: Option<ImageDimensions>, // For images
}

/// Image dimensions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
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

