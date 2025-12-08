use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserRelationship {
    pub id: String,
    pub user_id: String,
    pub related_user_id: String,
    pub relationship_type: String, // "friend", "blocked", "pending"
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRelationshipRequest {
    pub user_id: String,
    pub related_user_id: String,
    pub relationship_type: String,
}
