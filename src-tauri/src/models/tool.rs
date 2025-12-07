use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub endpoint: Option<String>,
    pub config: Option<String>,
    pub description: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateToolRequest {
    pub name: String,
    pub r#type: String,
    pub endpoint: Option<String>,
    pub config: Option<String>,
    pub description: Option<String>,
    pub is_enabled: Option<bool>,
}

