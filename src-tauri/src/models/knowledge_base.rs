use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct KnowledgeBase {
    pub id: String,
    pub name: String,
    pub r#type: String,
    #[ts(optional)]
    pub content: Option<String>,
    #[ts(optional)]
    pub url: Option<String>,
    #[ts(optional)]
    pub metadata: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateKnowledgeBaseRequest {
    pub name: String,
    pub r#type: String,
    #[ts(optional)]
    pub content: Option<String>,
    #[ts(optional)]
    pub url: Option<String>,
    #[ts(optional)]
    pub metadata: Option<String>,
}
