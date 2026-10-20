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
    /// Adjacency-list tree: parent message in the conversation. NULL = first
    /// turn (root level). Siblings under one parent are resend/regenerate
    /// variants; the conversation's active_message_id picks the live branch.
    #[ts(optional)]
    pub parent_id: Option<String>,
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
    /// Parent for the new message:
    /// - `None` — append under the conversation's active leaf
    /// - `Some("")` — root level (sibling of a first-turn message)
    /// - `Some(id)` — explicit parent (sibling variants, assistant replies)
    #[ts(optional)]
    pub parent_id: Option<String>,
    pub sender_type: String,
    #[ts(optional)]
    pub sender_id: Option<String>,
    pub content: String,
    #[ts(optional)]
    pub tokens: Option<i64>,
}
/// Sibling variants sharing one parent (resend/regenerate alternates).
/// `parent_id` NULL groups first-turn messages. Only groups with more than
/// one live member are returned; `message_ids` are ordered `(created_at, id)`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SiblingGroup {
    #[ts(optional)]
    pub parent_id: Option<String>,
    pub message_ids: Vec<String>,
}
