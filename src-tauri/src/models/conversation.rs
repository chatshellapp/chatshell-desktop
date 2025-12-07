use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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

/// Participant summary for UI display
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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

