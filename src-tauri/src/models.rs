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

// Conversation models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
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
    pub joined_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConversationParticipantRequest {
    pub conversation_id: String,
    pub participant_type: String,
    pub participant_id: Option<String>,
    pub display_name: Option<String>,
}

// Message models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: Option<String>,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub role: String,
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
    pub role: String,
    pub content: String,
    pub thinking_content: Option<String>,
    pub tokens: Option<i64>,
}

// External resource models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalResource {
    pub id: String,
    pub resource_type: String,  // "webpage", "image", "file"
    pub url: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub scraped_content: Option<String>,
    pub scraping_error: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateExternalResourceRequest {
    pub resource_type: String,
    pub url: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub metadata: Option<String>,
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

