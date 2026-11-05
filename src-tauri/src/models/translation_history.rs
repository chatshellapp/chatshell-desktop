use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

/// A completed translation kept in the device-local translation history.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct TranslationHistoryEntry {
    pub id: String,
    pub source_text: String,
    pub translated_text: String,
    /// Language code, or `auto` when the source was auto-detected.
    pub source_language: String,
    pub target_language: String,
    /// Database id of the model that produced the translation.
    pub model_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateTranslationHistoryRequest {
    pub source_text: String,
    pub translated_text: String,
    pub source_language: String,
    pub target_language: String,
    pub model_id: Option<String>,
}
