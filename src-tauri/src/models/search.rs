use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageSearchResult {
    pub message_id: String,
    pub conversation_id: String,
    pub conversation_title: Option<String>,
    pub sender_type: String,
    pub content_snippet: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSearchResult {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub last_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub messages: Vec<MessageSearchResult>,
    pub conversations: Vec<ConversationSearchResult>,
    pub total_message_count: usize,
    pub search_time_ms: f64,
}
