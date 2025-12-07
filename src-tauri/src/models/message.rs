use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Message model (thinking_content moved to thinking_steps table)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id: String,
    pub conversation_id: Option<String>,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub content: String,
    pub tokens: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMessageRequest {
    pub conversation_id: Option<String>,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub content: String,
    pub tokens: Option<i64>,
}

