use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateConversationRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct ConversationParticipant {
    pub id: String,
    pub conversation_id: String,
    pub participant_type: String, // "user", "model", "assistant"
    #[ts(optional)]
    pub participant_id: Option<String>,
    #[ts(optional)]
    pub display_name: Option<String>,
    pub role: String,   // "owner", "admin", "member", "observer"
    pub status: String, // "active", "left", "removed", "invited"
    pub joined_at: String,
    #[ts(optional)]
    pub left_at: Option<String>,
    #[ts(optional)]
    pub last_read_at: Option<String>,
    #[ts(optional)]
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateConversationParticipantRequest {
    pub conversation_id: String,
    pub participant_type: String,
    #[ts(optional)]
    pub participant_id: Option<String>,
    #[ts(optional)]
    pub display_name: Option<String>,
}

/// Participant summary for UI display
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct ParticipantSummary {
    pub participant_type: String,
    #[ts(optional)]
    pub participant_id: Option<String>,
    pub display_name: String,
    pub avatar_type: String,
    #[ts(optional)]
    pub avatar_bg: Option<String>,
    #[ts(optional)]
    pub avatar_text: Option<String>,
    #[ts(optional)]
    pub avatar_image_path: Option<String>,
    #[ts(optional)]
    pub avatar_image_url: Option<String>,
}
