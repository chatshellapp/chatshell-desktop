use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MessageSearchResult {
    pub message_id: String,
    pub conversation_id: String,
    #[ts(optional)]
    pub conversation_title: Option<String>,
    pub sender_type: String,
    pub content_snippet: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConversationSearchResult {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    #[ts(optional)]
    pub last_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SearchResults {
    pub messages: Vec<MessageSearchResult>,
    pub conversations: Vec<ConversationSearchResult>,
    pub total_message_count: usize,
    pub search_time_ms: f64,
}
