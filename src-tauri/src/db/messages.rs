use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{ConversationSearchResult, CreateMessageRequest, Message, MessageSearchResult};
use crate::search;
use crate::tokenizer;

impl Database {
    pub async fn create_message(&self, req: CreateMessageRequest) -> Result<Message> {
        tracing::info!("🔒 [db] Creating message...");
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        let target_id = req.conversation_id.as_deref().unwrap_or("unknown");
        tracing::info!(
            "💾 [db] Executing INSERT for message (conversation_id: {})",
            target_id
        );

        sqlx::query(
            "INSERT INTO messages (id, conversation_id, sender_type, sender_id, content, tokens, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.conversation_id)
        .bind(&req.sender_type)
        .bind(&req.sender_id)
        .bind(&req.content)
        .bind(req.tokens)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        let tokenized = tokenizer::tokenize_for_search(&req.content);
        let conv_id = req.conversation_id.as_deref().unwrap_or("");
        sqlx::query(
            "INSERT INTO messages_fts(content, message_id, conversation_id) VALUES (?, ?, ?)",
        )
        .bind(&tokenized)
        .bind(&id)
        .bind(conv_id)
        .execute(self.pool.as_ref())
        .await?;

        if !conv_id.is_empty() {
            sqlx::query("UPDATE conversations SET updated_at = ? WHERE id = ?")
                .bind(&now)
                .bind(conv_id)
                .execute(self.pool.as_ref())
                .await?;
        }

        tracing::info!("✅ [db] INSERT completed");

        tracing::info!("🔍 [db] Retrieving created message...");
        let result = self
            .get_message(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created message"));
        tracing::info!("✅ [db] Message retrieved: {:?}", result.is_ok());
        result
    }

    pub async fn get_message(&self, id: &str) -> Result<Option<Message>> {
        let row = sqlx::query(
            "SELECT id, conversation_id, sender_type, sender_id, content, tokens, created_at
             FROM messages WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(Some(Message {
                id: row.get("id"),
                conversation_id: row.get("conversation_id"),
                sender_type: row.get("sender_type"),
                sender_id: row.get("sender_id"),
                content: row.get("content"),
                tokens: row.get("tokens"),
                created_at: row.get("created_at"),
            })),
            None => Ok(None),
        }
    }

    pub async fn list_messages_by_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<Message>> {
        let rows = sqlx::query(
            "SELECT id, conversation_id, sender_type, sender_id, content, tokens, created_at
             FROM messages WHERE conversation_id = ? AND deleted_at IS NULL
             ORDER BY created_at ASC",
        )
        .bind(conversation_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let messages = rows
            .iter()
            .map(|row| Message {
                id: row.get("id"),
                conversation_id: row.get("conversation_id"),
                sender_type: row.get("sender_type"),
                sender_id: row.get("sender_id"),
                content: row.get("content"),
                tokens: row.get("tokens"),
                created_at: row.get("created_at"),
            })
            .collect();

        Ok(messages)
    }

    pub async fn delete_messages_in_conversation(&self, conversation_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM messages_fts WHERE conversation_id = ?")
            .bind(conversation_id)
            .execute(self.pool.as_ref())
            .await?;
        // Children first (while the parent rows still read as live), then
        // the messages themselves.
        crate::db::soft_delete::tombstone_children_of_messages(
            self.pool.as_ref(),
            "conversation_id = ?",
            &[conversation_id],
        )
        .await?;
        // Soft-delete (ADR 01): truncated messages tombstone instead of hard
        // DELETE so the deletion propagates through snapshot merges.
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "messages",
            "conversation_id = ?2 AND deleted_at IS NULL",
        ))
        .bind(&now)
        .bind(conversation_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    pub async fn delete_messages_from(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<()> {
        let target = self.get_message(message_id).await?;
        let target = target.ok_or_else(|| anyhow::anyhow!("Message not found: {}", message_id))?;

        sqlx::query(
            "DELETE FROM messages_fts WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ? AND created_at >= ?)",
        )
        .bind(conversation_id)
        .bind(&target.created_at)
        .execute(self.pool.as_ref())
        .await?;
        // Children first (while the parent rows still read as live), then
        // the messages themselves.
        crate::db::soft_delete::tombstone_children_of_messages(
            self.pool.as_ref(),
            "conversation_id = ? AND created_at >= ?",
            &[conversation_id, &target.created_at],
        )
        .await?;
        // Soft-delete (ADR 01): regenerated tail messages tombstone instead
        // of hard DELETE so the truncation propagates through merges.
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "messages",
            "conversation_id = ?2 AND created_at >= ?3 AND deleted_at IS NULL",
        ))
        .bind(&now)
        .bind(conversation_id)
        .bind(&target.created_at)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    /// Backfill messages_fts with existing messages (idempotent; runs once per DB).
    pub async fn backfill_fts(&self) -> Result<()> {
        const FTS_BACKFILLED_KEY: &str = "fts_backfilled";
        if self.get_setting(FTS_BACKFILLED_KEY).await?.as_deref() == Some("1") {
            return Ok(());
        }

        #[derive(sqlx::FromRow)]
        struct MessageRow {
            id: String,
            conversation_id: Option<String>,
            content: String,
        }

        let rows = sqlx::query_as::<_, MessageRow>(
            "SELECT id, conversation_id, content FROM messages WHERE deleted_at IS NULL",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        sqlx::query("DELETE FROM messages_fts")
            .execute(self.pool.as_ref())
            .await?;

        for row in &rows {
            let tokenized = tokenizer::tokenize_for_search(&row.content);
            let conv_id = row.conversation_id.as_deref().unwrap_or("");
            sqlx::query(
                "INSERT OR IGNORE INTO messages_fts(content, message_id, conversation_id) VALUES (?, ?, ?)",
            )
            .bind(&tokenized)
            .bind(&row.id)
            .bind(conv_id)
            .execute(self.pool.as_ref())
            .await?;
        }

        self.set_setting(FTS_BACKFILLED_KEY, "1").await?;
        tracing::info!("FTS backfill completed for {} messages", rows.len());
        Ok(())
    }

    /// Reconcile `messages_fts` with `messages` after a snapshot merge.
    ///
    /// Merged rows arrive through the engine's ATTACH/INSERT path and bypass
    /// `create_message`'s FTS maintenance, so the index drifts: new rows are
    /// unindexed, merge-applied tombstones leave stale entries (local
    /// tombstones delete eagerly), and a crash mid-pass leaves the index
    /// partial. `backfill_fts` cannot help here — its `fts_backfilled` guard
    /// turns it into a one-time full rebuild at startup.
    ///
    /// Pure set reconciliation — no clocks, no stored state (the `settings`
    /// table is itself synced, so a watermark there would leak across
    /// devices): drop entries whose message is tombstoned or gone, then index
    /// live messages missing from the index. Convergent and idempotent.
    ///
    /// Invariant relied on: message `content` is append-only (no code path
    /// UPDATEs it; edits are modeled as new rows). If an in-place edit is
    /// ever added, it must reindex that message's FTS row itself — an
    /// indexed-but-changed row is invisible to this pass.
    pub async fn sync_fts_incremental(&self) -> Result<()> {
        #[derive(sqlx::FromRow)]
        struct MessageRow {
            id: String,
            conversation_id: Option<String>,
            content: String,
        }

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "DELETE FROM messages_fts \
             WHERE message_id IN (SELECT id FROM messages WHERE deleted_at IS NOT NULL) \
                OR message_id NOT IN (SELECT id FROM messages)",
        )
        .execute(&mut *tx)
        .await?;

        let rows = sqlx::query_as::<_, MessageRow>(
            "SELECT id, conversation_id, content FROM messages \
             WHERE deleted_at IS NULL \
               AND id NOT IN (SELECT message_id FROM messages_fts)",
        )
        .fetch_all(&mut *tx)
        .await?;

        for row in &rows {
            let tokenized = tokenizer::tokenize_for_search(&row.content);
            sqlx::query(
                "INSERT INTO messages_fts(content, message_id, conversation_id) VALUES (?, ?, ?)",
            )
            .bind(&tokenized)
            .bind(&row.id)
            .bind(row.conversation_id.as_deref().unwrap_or(""))
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        if !rows.is_empty() {
            tracing::info!("FTS incremental sync indexed {} messages", rows.len());
        }
        Ok(())
    }

    pub async fn search_messages(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<MessageSearchResult>> {
        let tokenized_query = tokenizer::tokenize_query(query);
        if tokenized_query.trim().is_empty() {
            return Ok(Vec::new());
        }

        #[derive(sqlx::FromRow)]
        struct Row {
            message_id: String,
            conversation_id: Option<String>,
            conversation_title: Option<String>,
            sender_type: String,
            content: String,
            created_at: String,
        }

        let rows = sqlx::query_as::<_, Row>(
            "SELECT m.id as message_id, m.conversation_id, c.title as conversation_title,
                    m.sender_type, m.content, m.created_at
             FROM messages_fts fts
             JOIN messages m ON m.id = fts.message_id
             LEFT JOIN conversations c ON c.id = m.conversation_id
             WHERE messages_fts MATCH ? AND m.deleted_at IS NULL
               AND (c.id IS NULL OR c.deleted_at IS NULL)
             ORDER BY fts.rank
             LIMIT ? OFFSET ?",
        )
        .bind(&tokenized_query)
        .bind(limit)
        .bind(offset)
        .fetch_all(self.pool.as_ref())
        .await?;

        let query_terms: Vec<String> = tokenized_query
            .split_whitespace()
            .map(String::from)
            .collect();

        let results = rows
            .into_iter()
            .map(|r| {
                let content_snippet =
                    search::snippet::build_snippet(&r.content, &query_terms, 6, 1, 120);
                MessageSearchResult {
                    message_id: r.message_id,
                    conversation_id: r.conversation_id.unwrap_or_default(),
                    conversation_title: r.conversation_title,
                    sender_type: r.sender_type,
                    content_snippet,
                    created_at: r.created_at,
                }
            })
            .collect();

        Ok(results)
    }

    pub async fn search_conversations(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<ConversationSearchResult>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = format!("%{}%", query);

        #[derive(sqlx::FromRow)]
        struct Row {
            id: String,
            title: String,
            updated_at: String,
            last_message: Option<String>,
        }

        let rows = sqlx::query_as::<_, Row>(
            "SELECT c.id, c.title, c.updated_at,
                    (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message
             FROM conversations c
             WHERE c.title LIKE ? AND c.deleted_at IS NULL
             ORDER BY c.updated_at DESC
             LIMIT ?",
        )
        .bind(&pattern)
        .bind(limit)
        .fetch_all(self.pool.as_ref())
        .await?;

        let results = rows
            .into_iter()
            .map(|r| ConversationSearchResult {
                id: r.id,
                title: r.title,
                updated_at: r.updated_at,
                last_message: r.last_message,
            })
            .collect();

        Ok(results)
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

    /// Insert a message row the way a snapshot merge does: direct SQL that
    /// bypasses `create_message`'s FTS maintenance.
    async fn merged_message(db: &Database, id: &str, content: &str, ts: &str) {
        sqlx::query(
            "INSERT INTO messages (id, sender_type, content, created_at, updated_at) \
             VALUES (?, 'user', ?, ?, ?)",
        )
        .bind(id)
        .bind(content)
        .bind(ts)
        .bind(ts)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn fts_entry_count(db: &Database, message_id: &str) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts WHERE message_id = ?")
            .bind(message_id)
            .fetch_one(db.pool())
            .await
            .unwrap()
    }

    async fn search_hits(db: &Database, query: &str) -> Vec<String> {
        db.search_messages(query, 50, 0)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.message_id)
            .collect()
    }

    #[tokio::test]
    async fn merged_rows_become_searchable() {
        let (db, _dir) = test_db().await;
        merged_message(&db, "m1", "zebra crossing ahead", "2026-01-01T00:00:00Z").await;
        merged_message(&db, "m2", "quixotic tangram", "2026-01-02T00:00:00Z").await;

        assert!(
            search_hits(&db, "zebra").await.is_empty(),
            "sanity: not indexed yet"
        );

        db.sync_fts_incremental().await.unwrap();

        assert_eq!(search_hits(&db, "zebra").await, vec!["m1"]);
        assert_eq!(search_hits(&db, "quixotic").await, vec!["m2"]);
    }

    #[tokio::test]
    async fn second_run_is_noop() {
        let (db, _dir) = test_db().await;
        merged_message(&db, "m1", "stable content", "2026-01-01T00:00:00Z").await;
        db.sync_fts_incremental().await.unwrap();

        let before: Vec<(String, String)> =
            sqlx::query_as("SELECT message_id, content FROM messages_fts ORDER BY message_id")
                .fetch_all(db.pool())
                .await
                .unwrap();

        db.sync_fts_incremental().await.unwrap();

        let after: Vec<(String, String)> =
            sqlx::query_as("SELECT message_id, content FROM messages_fts ORDER BY message_id")
                .fetch_all(db.pool())
                .await
                .unwrap();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn tombstone_arriving_via_merge_drops_entry() {
        let (db, _dir) = test_db().await;
        merged_message(&db, "m1", "ephemeral note", "2026-01-01T00:00:00Z").await;
        db.sync_fts_incremental().await.unwrap();
        assert_eq!(fts_entry_count(&db, "m1").await, 1);

        // Merge-applied tombstone: raw UPDATE, bypassing the local eager
        // FTS delete that delete_messages_in_conversation performs.
        sqlx::query("UPDATE messages SET deleted_at = '2026-01-02T00:00:00Z' WHERE id = 'm1'")
            .execute(db.pool())
            .await
            .unwrap();

        db.sync_fts_incremental().await.unwrap();

        assert_eq!(fts_entry_count(&db, "m1").await, 0);
        assert!(search_hits(&db, "ephemeral").await.is_empty());
    }

    #[tokio::test]
    async fn orphaned_entries_removed() {
        let (db, _dir) = test_db().await;
        merged_message(&db, "m1", "vanishing ink", "2026-01-01T00:00:00Z").await;
        db.sync_fts_incremental().await.unwrap();

        sqlx::query("DELETE FROM messages WHERE id = 'm1'")
            .execute(db.pool())
            .await
            .unwrap();

        db.sync_fts_incremental().await.unwrap();

        assert_eq!(fts_entry_count(&db, "m1").await, 0);
    }

    #[tokio::test]
    async fn missing_entries_selfheal() {
        let (db, _dir) = test_db().await;
        merged_message(&db, "m1", "resilient text", "2026-01-01T00:00:00Z").await;
        db.sync_fts_incremental().await.unwrap();

        // Simulate drift: index entry lost (crash between insert and commit,
        // or a resurrected row after eager tombstone delete).
        sqlx::query("DELETE FROM messages_fts WHERE message_id = 'm1'")
            .execute(db.pool())
            .await
            .unwrap();

        db.sync_fts_incremental().await.unwrap();

        assert_eq!(search_hits(&db, "resilient").await, vec!["m1"]);
    }

    #[tokio::test]
    async fn create_message_path_not_duplicated() {
        let (db, _dir) = test_db().await;
        db.create_message(CreateMessageRequest {
            conversation_id: None,
            sender_type: "user".into(),
            sender_id: None,
            content: "ordinary path".into(),
            tokens: Some(3),
        })
        .await
        .unwrap();

        db.sync_fts_incremental().await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count, 1, "exactly one entry per live message");
    }
}
