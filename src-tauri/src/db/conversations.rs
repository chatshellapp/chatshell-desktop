use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{
    Conversation, ConversationParticipant, CreateConversationParticipantRequest,
    CreateConversationRequest, ParticipantSummary,
};

impl Database {
    // Conversation CRUD operations
    pub async fn create_conversation(
        &self,
        req: CreateConversationRequest,
    ) -> Result<Conversation> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.title)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_conversation(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created conversation"))
    }

    pub async fn get_conversation(&self, id: &str) -> Result<Option<Conversation>> {
        let row = sqlx::query(
            "SELECT 
                c.id, 
                c.title, 
                c.created_at, 
                c.updated_at,
                (SELECT m.content 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message
             FROM conversations c 
             WHERE c.id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(Some(Conversation {
                id: row.get("id"),
                title: row.get("title"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                last_message: row.get("last_message"),
            })),
            None => Ok(None),
        }
    }

    pub async fn list_conversations(&self) -> Result<Vec<Conversation>> {
        let rows = sqlx::query(
            "SELECT 
                c.id, 
                c.title, 
                c.created_at, 
                c.updated_at,
                (SELECT m.content 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message
             FROM conversations c 
             ORDER BY c.updated_at DESC",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let conversations = rows
            .iter()
            .map(|row| Conversation {
                id: row.get("id"),
                title: row.get("title"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                last_message: row.get("last_message"),
            })
            .collect();

        Ok(conversations)
    }

    pub async fn update_conversation(&self, id: &str, title: &str) -> Result<Conversation> {
        let now = Utc::now().to_rfc3339();

        sqlx::query("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        self.get_conversation(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Conversation not found"))
    }

    pub async fn delete_conversation(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM conversations WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // Conversation Participant operations
    pub async fn add_conversation_participant(
        &self,
        req: CreateConversationParticipantRequest,
    ) -> Result<ConversationParticipant> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO conversation_participants 
             (id, conversation_id, participant_type, participant_id, display_name, role, status, joined_at)
             VALUES (?, ?, ?, ?, ?, 'member', 'active', ?)"
        )
        .bind(&id)
        .bind(&req.conversation_id)
        .bind(&req.participant_type)
        .bind(&req.participant_id)
        .bind(&req.display_name)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_conversation_participant(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created participant"))
    }

    pub async fn get_conversation_participant(
        &self,
        id: &str,
    ) -> Result<Option<ConversationParticipant>> {
        let row = sqlx::query(
            "SELECT id, conversation_id, participant_type, participant_id, display_name, 
             role, status, joined_at, left_at, last_read_at, metadata
             FROM conversation_participants WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(Some(ConversationParticipant {
                id: row.get("id"),
                conversation_id: row.get("conversation_id"),
                participant_type: row.get("participant_type"),
                participant_id: row.get("participant_id"),
                display_name: row.get("display_name"),
                role: row.get("role"),
                status: row.get("status"),
                joined_at: row.get("joined_at"),
                left_at: row.get("left_at"),
                last_read_at: row.get("last_read_at"),
                metadata: row.get("metadata"),
            })),
            None => Ok(None),
        }
    }

    pub async fn list_conversation_participants(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationParticipant>> {
        let rows = sqlx::query(
            "SELECT id, conversation_id, participant_type, participant_id, display_name, 
             role, status, joined_at, left_at, last_read_at, metadata
             FROM conversation_participants WHERE conversation_id = ? ORDER BY joined_at",
        )
        .bind(conversation_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let participants = rows
            .iter()
            .map(|row| ConversationParticipant {
                id: row.get("id"),
                conversation_id: row.get("conversation_id"),
                participant_type: row.get("participant_type"),
                participant_id: row.get("participant_id"),
                display_name: row.get("display_name"),
                role: row.get("role"),
                status: row.get("status"),
                joined_at: row.get("joined_at"),
                left_at: row.get("left_at"),
                last_read_at: row.get("last_read_at"),
                metadata: row.get("metadata"),
            })
            .collect();

        Ok(participants)
    }

    pub async fn get_conversation_participant_summary(
        &self,
        conversation_id: &str,
        current_user_id: &str,
    ) -> Result<Vec<ParticipantSummary>> {
        let rows = sqlx::query(
            "SELECT DISTINCT
                cp.participant_type,
                cp.participant_id,
                COALESCE(cp.display_name, u.display_name, a.name, m.name, 'Unknown') as display_name,
                COALESCE(
                    CASE cp.participant_type
                        WHEN 'user' THEN u.avatar_type
                        WHEN 'assistant' THEN a.avatar_type
                        ELSE 'text'
                    END, 'text'
                ) as avatar_type,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_bg
                    WHEN 'assistant' THEN a.avatar_bg
                    ELSE NULL
                END as avatar_bg,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_text
                    WHEN 'assistant' THEN a.avatar_text
                    ELSE NULL
                END as avatar_text,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_image_path
                    WHEN 'assistant' THEN a.avatar_image_path
                    ELSE NULL
                END as avatar_image_path,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_image_url
                    WHEN 'assistant' THEN a.avatar_image_url
                    ELSE NULL
                END as avatar_image_url
             FROM conversation_participants cp
             LEFT JOIN users u ON cp.participant_type = 'user' AND cp.participant_id = u.id
             LEFT JOIN assistants a ON cp.participant_type = 'assistant' AND cp.participant_id = a.id
             LEFT JOIN models m ON cp.participant_type = 'model' AND cp.participant_id = m.id
             WHERE cp.conversation_id = ? 
               AND cp.status = 'active'
               AND NOT (cp.participant_type = 'user' AND cp.participant_id = ?)
             ORDER BY cp.joined_at"
        )
        .bind(conversation_id)
        .bind(current_user_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let summaries = rows
            .iter()
            .map(|row| ParticipantSummary {
                participant_type: row.get("participant_type"),
                participant_id: row.get("participant_id"),
                display_name: row.get("display_name"),
                avatar_type: row.get("avatar_type"),
                avatar_bg: row.get("avatar_bg"),
                avatar_text: row.get("avatar_text"),
                avatar_image_path: row.get("avatar_image_path"),
                avatar_image_url: row.get("avatar_image_url"),
            })
            .collect();

        Ok(summaries)
    }

    pub async fn remove_conversation_participant(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM conversation_participants WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }
}
