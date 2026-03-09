use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{
    ConversationSearchResult, CreateMessageRequest, Message, MessageSearchResult,
};
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
            "INSERT INTO messages (id, conversation_id, sender_type, sender_id, content, tokens, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.conversation_id)
        .bind(&req.sender_type)
        .bind(&req.sender_id)
        .bind(&req.content)
        .bind(req.tokens)
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
             FROM messages WHERE id = ?",
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
             FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
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
        sqlx::query("DELETE FROM messages WHERE conversation_id = ?")
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
        sqlx::query("DELETE FROM messages WHERE conversation_id = ? AND created_at >= ?")
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
            "SELECT id, conversation_id, content FROM messages",
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
             WHERE messages_fts MATCH ?
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
                    (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message
             FROM conversations c
             WHERE c.title LIKE ?
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
