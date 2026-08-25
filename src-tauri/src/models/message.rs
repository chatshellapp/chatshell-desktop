use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

/// Message model (thinking_content moved to thinking_steps table)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct Message {
    pub id: String,
    #[ts(optional)]
    pub conversation_id: Option<String>,
    pub sender_type: String,
    #[ts(optional)]
    pub sender_id: Option<String>,
    pub content: String,
    #[ts(optional)]
    pub tokens: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateMessageRequest {
    #[ts(optional)]
    pub conversation_id: Option<String>,
    pub sender_type: String,
    #[ts(optional)]
    pub sender_id: Option<String>,
    pub content: String,
    #[ts(optional)]
    pub tokens: Option<i64>,
}
