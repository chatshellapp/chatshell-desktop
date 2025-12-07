use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{
    CreateFileAttachmentRequest, CreateUserLinkRequest, FileAttachment, UserAttachment,
    UserAttachmentType, UserLink,
};

impl Database {
    // File Attachment operations
    pub async fn create_file_attachment(
        &self,
        req: CreateFileAttachmentRequest,
    ) -> Result<FileAttachment> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO files (id, file_name, file_size, mime_type, storage_path, content_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.file_name)
        .bind(req.file_size)
        .bind(&req.mime_type)
        .bind(&req.storage_path)
        .bind(&req.content_hash)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_file_attachment(&id).await
    }

    pub async fn get_file_attachment(&self, id: &str) -> Result<FileAttachment> {
        let row = sqlx::query(
            "SELECT id, file_name, file_size, mime_type, storage_path, content_hash, created_at
             FROM files WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("File attachment not found"))?;

        Ok(FileAttachment {
            id: row.get("id"),
            file_name: row.get("file_name"),
            file_size: row.get("file_size"),
            mime_type: row.get("mime_type"),
            storage_path: row.get("storage_path"),
            content_hash: row.get("content_hash"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn find_file_by_hash(&self, content_hash: &str) -> Result<Option<FileAttachment>> {
        let row = sqlx::query(
            "SELECT id, file_name, file_size, mime_type, storage_path, content_hash, created_at
             FROM files WHERE content_hash = ? LIMIT 1"
        )
        .bind(content_hash)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(Some(FileAttachment {
                id: row.get("id"),
                file_name: row.get("file_name"),
                file_size: row.get("file_size"),
                mime_type: row.get("mime_type"),
                storage_path: row.get("storage_path"),
                content_hash: row.get("content_hash"),
                created_at: row.get("created_at"),
            })),
            None => Ok(None),
        }
    }

    pub async fn delete_file_attachment(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM files WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // User Link operations
    pub async fn create_user_link(&self, req: CreateUserLinkRequest) -> Result<UserLink> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO user_links (id, url, title, created_at)
             VALUES (?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.url)
        .bind(&req.title)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_user_link(&id).await
    }

    pub async fn get_user_link(&self, id: &str) -> Result<UserLink> {
        let row = sqlx::query("SELECT id, url, title, created_at FROM user_links WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await?
            .ok_or_else(|| anyhow::anyhow!("User link not found"))?;

        Ok(UserLink {
            id: row.get("id"),
            url: row.get("url"),
            title: row.get("title"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn delete_user_link(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM user_links WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // Message Attachment Link operations
    pub async fn link_message_attachment(
        &self,
        message_id: &str,
        attachment_type: UserAttachmentType,
        attachment_id: &str,
        display_order: Option<i32>,
    ) -> Result<()> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let order = display_order.unwrap_or(0);

        sqlx::query(
            "INSERT OR IGNORE INTO message_attachments
             (id, message_id, attachment_type, attachment_id, display_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(message_id)
        .bind(attachment_type.to_string())
        .bind(attachment_id)
        .bind(order)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }

    pub async fn get_message_attachments(&self, message_id: &str) -> Result<Vec<UserAttachment>> {
        let rows = sqlx::query(
            "SELECT attachment_type, attachment_id, display_order
             FROM message_attachments
             WHERE message_id = ?
             ORDER BY display_order, created_at"
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut attachments = Vec::new();
        for row in rows {
            let attachment_type: String = row.get("attachment_type");
            let attachment_id: String = row.get("attachment_id");

            let attachment = match attachment_type.as_str() {
                "file" => self
                    .get_file_attachment(&attachment_id)
                    .await
                    .map(UserAttachment::File)
                    .ok(),
                "user_link" => self
                    .get_user_link(&attachment_id)
                    .await
                    .map(UserAttachment::UserLink)
                    .ok(),
                _ => None,
            };
            if let Some(a) = attachment {
                attachments.push(a);
            }
        }

        Ok(attachments)
    }

    pub async fn unlink_message_attachment(
        &self,
        message_id: &str,
        attachment_type: UserAttachmentType,
        attachment_id: &str,
    ) -> Result<()> {
        sqlx::query(
            "DELETE FROM message_attachments WHERE message_id = ? AND attachment_type = ? AND attachment_id = ?"
        )
        .bind(message_id)
        .bind(attachment_type.to_string())
        .bind(attachment_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}

