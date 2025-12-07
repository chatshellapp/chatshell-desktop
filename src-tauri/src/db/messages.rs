use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateMessageRequest, Message};

impl Database {
    pub async fn create_message(&self, req: CreateMessageRequest) -> Result<Message> {
        println!("🔒 [db] Creating message...");
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        let target_id = req
            .conversation_id
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("unknown");
        println!(
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

        println!("✅ [db] INSERT completed");

        println!("🔍 [db] Retrieving created message...");
        let result = self
            .get_message(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created message"));
        println!("✅ [db] Message retrieved: {:?}", result.is_ok());
        result
    }

    pub async fn get_message(&self, id: &str) -> Result<Option<Message>> {
        let row = sqlx::query(
            "SELECT id, conversation_id, sender_type, sender_id, content, tokens, created_at
             FROM messages WHERE id = ?"
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

    pub async fn list_messages_by_conversation(&self, conversation_id: &str) -> Result<Vec<Message>> {
        let rows = sqlx::query(
            "SELECT id, conversation_id, sender_type, sender_id, content, tokens, created_at
             FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
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
        sqlx::query("DELETE FROM messages WHERE conversation_id = ?")
            .bind(conversation_id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }
}

