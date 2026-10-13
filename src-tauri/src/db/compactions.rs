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

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    async fn seed_conversation(db: &Database, id: &str) {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at)
             VALUES (?, 'test', ?, ?)",
        )
        .bind(id)
        .bind(&now)
        .bind(&now)
        .execute(db.pool.as_ref())
        .await
        .unwrap();
    }

    fn request(
        conversation_id: &str,
        method: &str,
        archive_json: Option<String>,
    ) -> CreateCompactionRequest {
        CreateCompactionRequest {
            conversation_id: conversation_id.to_string(),
            summary: format!("{method} summary"),
            first_kept_message_id: format!("keep-{method}"),
            tokens_before: 90_000,
            method: method.to_string(),
            archive_json,
        }
    }

    #[tokio::test]
    async fn latest_active_compaction_picks_newest_and_skips_deleted() {
        let (db, _dir) = test_db().await;
        seed_conversation(&db, "conv-1").await;
        assert!(
            db.latest_active_compaction("conv-1")
                .await
                .unwrap()
                .is_none()
        );

        let first = db
            .create_compaction(request("conv-1", "soft", None))
            .await
            .unwrap();
        assert_eq!(
            db.latest_active_compaction("conv-1")
                .await
                .unwrap()
                .unwrap()
                .id,
            first.id
        );

        // Re-compaction: a newer row becomes the active boundary.
        let archive_json = r#"{"shape":"11on16-bw","head_text":"h","tail_text":"t","frames":[],"chars_dropped":0}"#;
        let second = db
            .create_compaction(request(
                "conv-1",
                "snapcompact",
                Some(archive_json.to_string()),
            ))
            .await
            .unwrap();

        let latest = db
            .latest_active_compaction("conv-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(latest.id, second.id);
        assert_eq!(latest.method, "snapcompact");
        assert_eq!(latest.archive_json.as_deref(), Some(archive_json));

        // Tombstoning the newest row rewinds the active boundary to the
        // previous one (fork rewind path).
        sqlx::query("UPDATE compactions SET deleted_at = ? WHERE id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(&second.id)
            .execute(db.pool.as_ref())
            .await
            .unwrap();
        let rewound = db
            .latest_active_compaction("conv-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(rewound.id, first.id);
        assert_eq!(rewound.method, "soft");
    }

    #[tokio::test]
    async fn compactions_of_other_conversations_are_isolated() {
        let (db, _dir) = test_db().await;
        seed_conversation(&db, "conv-a").await;
        seed_conversation(&db, "conv-b").await;
        db.create_compaction(request("conv-a", "soft", None))
            .await
            .unwrap();
        assert!(
            db.latest_active_compaction("conv-b")
                .await
                .unwrap()
                .is_none()
        );
    }
}
