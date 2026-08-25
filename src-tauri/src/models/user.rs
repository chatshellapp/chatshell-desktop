use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: String,
    #[ts(optional)]
    pub email: Option<String>,
    pub avatar_type: String,
    #[ts(optional)]
    pub avatar_bg: Option<String>,
    #[ts(optional)]
    pub avatar_text: Option<String>,
    #[ts(optional)]
    pub avatar_image_path: Option<String>,
    #[ts(optional)]
    pub avatar_image_url: Option<String>,
    pub is_self: bool,
    pub status: String,
    #[ts(optional)]
    pub last_seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    #[ts(optional)]
    pub email: Option<String>,
    #[ts(optional)]
    pub avatar_type: Option<String>,
    #[ts(optional)]
    pub avatar_bg: Option<String>,
    #[ts(optional)]
    pub avatar_text: Option<String>,
    #[ts(optional)]
    pub avatar_image_path: Option<String>,
    #[ts(optional)]
    pub avatar_image_url: Option<String>,
    #[ts(optional)]
    pub is_self: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct UserRelationship {
    pub id: String,
    pub user_id: String,
    pub related_user_id: String,
    pub relationship_type: String, // "friend", "blocked", "pending"
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateUserRelationshipRequest {
    pub user_id: String,
    pub related_user_id: String,
    pub relationship_type: String,
}
