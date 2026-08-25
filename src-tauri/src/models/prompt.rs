use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct Prompt {
    pub id: String,
    pub name: String,
    pub content: String,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub category: Option<String>,
    pub is_system: bool,
    pub is_starred: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePromptRequest {
    pub name: String,
    pub content: String,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub category: Option<String>,
    #[ts(optional)]
    pub is_system: Option<bool>,
}
