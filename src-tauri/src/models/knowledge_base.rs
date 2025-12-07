use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct KnowledgeBase {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub content: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKnowledgeBaseRequest {
    pub name: String,
    pub r#type: String,
    pub content: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<String>,
}

