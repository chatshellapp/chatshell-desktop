use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Prompt {
    pub id: String,
    pub name: String,
    pub content: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_system: bool,
    pub is_starred: bool,
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
