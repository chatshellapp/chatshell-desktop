//! Compaction persistence: one row per context-compaction event.

use super::Database;
use anyhow::Result;
use chrono::Utc;
use sqlx::FromRow;
use uuid::Uuid;

/// A persisted compaction (schema v11). `first_kept_message_id` is the
/// boundary: the LLM projection replaces everything before it with the
/// summary / archive and keeps the suffix verbatim.
#[derive(Debug, Clone, FromRow)]
pub struct Compaction {
    pub id: String,
    pub conversation_id: String,
    pub summary: String,
    pub first_kept_message_id: String,
    pub tokens_before: i64,
    /// `soft` (LLM summary) or `snapcompact` (bitmap archive).
    pub method: String,
    /// Serialized `chatshell_agent_core::snapcompact::SnapcompactArchive`
    /// when method = snapcompact.
    pub archive_json: Option<String>,
    pub created_at: String,
}

/// Request to record one compaction.
#[derive(Debug, Clone)]
pub struct CreateCompactionRequest {
    pub conversation_id: String,
    pub summary: String,
    pub first_kept_message_id: String,
    pub tokens_before: i64,
    pub method: String,
    pub archive_json: Option<String>,
}

impl Database {
    pub async fn create_compaction(&self, req: CreateCompactionRequest) -> Result<Compaction> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO compactions (id, conversation_id, summary, first_kept_message_id, tokens_before, method, archive_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.conversation_id)
        .bind(&req.summary)
        .bind(&req.first_kept_message_id)
        .bind(req.tokens_before)
        .bind(&req.method)
        .bind(&req.archive_json)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        Ok(Compaction {
            id,
            conversation_id: req.conversation_id,
            summary: req.summary,
            first_kept_message_id: req.first_kept_message_id,
            tokens_before: req.tokens_before,
            method: req.method,
            archive_json: req.archive_json,
            created_at: now,
        })
    }

    /// Latest non-deleted compaction for a conversation.
    pub async fn latest_active_compaction(
        &self,
        conversation_id: &str,
    ) -> Result<Option<Compaction>> {
        let row = sqlx::query_as::<_, Compaction>(
            "SELECT id, conversation_id, summary, first_kept_message_id, tokens_before, method, archive_json, created_at
             FROM compactions
             WHERE conversation_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(conversation_id)
        .fetch_optional(self.pool.as_ref())
        .await?;
        Ok(row)
    }
}
