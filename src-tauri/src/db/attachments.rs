use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateFileAttachmentRequest, FileAttachment, UserAttachment};

impl Database {
    // File Attachment operations
    pub async fn create_file_attachment(
        &self,
        req: CreateFileAttachmentRequest,
    ) -> Result<FileAttachment> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO files (id, file_name, file_size, mime_type, storage_path, content_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.file_name)
        .bind(req.file_size)
        .bind(&req.mime_type)
        .bind(&req.storage_path)
        .bind(&req.content_hash)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_file_attachment(&id).await
    }

    pub async fn get_file_attachment(&self, id: &str) -> Result<FileAttachment> {
        let row = sqlx::query(
            "SELECT id, file_name, file_size, mime_type, storage_path, content_hash, created_at
             FROM files WHERE files.deleted_at IS NULL AND id = ?",
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
             FROM files WHERE files.deleted_at IS NULL AND content_hash = ? LIMIT 1",
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
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "files",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    // Message Attachment Link operations (files only)
    pub async fn link_message_attachment(
        &self,
        message_id: &str,
        attachment_id: &str,
        display_order: Option<i32>,
    ) -> Result<()> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let order = display_order.unwrap_or(0);

        sqlx::query(
            "INSERT OR IGNORE INTO message_attachments
             (id, message_id, attachment_type, attachment_id, display_order, created_at)
             VALUES (?, ?, 'file', ?, ?, ?)",
        )
        .bind(&id)
        .bind(message_id)
        .bind(attachment_id)
        .bind(order)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }

    pub async fn get_message_attachments(&self, message_id: &str) -> Result<Vec<UserAttachment>> {
        let rows = sqlx::query(
            "SELECT attachment_id, display_order
             FROM message_attachments
             WHERE message_attachments.deleted_at IS NULL AND message_id = ?
             ORDER BY display_order, created_at",
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut attachments = Vec::new();
        for row in rows {
            let attachment_id: String = row.get("attachment_id");

            if let Ok(file) = self.get_file_attachment(&attachment_id).await {
                attachments.push(UserAttachment::File(file));
            }
        }

        Ok(attachments)
    }

    /// Attachments for several messages in one query. Used by the LLM
    /// projection, which needs a manifest for every historical user turn.
    pub async fn get_message_attachments_batch(
        &self,
        message_ids: &[String],
    ) -> Result<std::collections::HashMap<String, Vec<UserAttachment>>> {
        let mut by_message: std::collections::HashMap<String, Vec<UserAttachment>> =
            std::collections::HashMap::new();
        // Keep the IN list below SQLite's bound-parameter limit.
        for chunk in message_ids.chunks(800) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT ma.message_id, f.id, f.file_name, f.file_size, f.mime_type,
                        f.storage_path, f.content_hash, f.created_at
                 FROM message_attachments ma
                 JOIN files f ON f.id = ma.attachment_id
                 WHERE ma.deleted_at IS NULL AND f.deleted_at IS NULL
                   AND ma.message_id IN ({placeholders})
                 ORDER BY ma.message_id, ma.display_order, ma.created_at"
            );
            let mut query = sqlx::query(&sql);
            for id in chunk {
                query = query.bind(id);
            }
            let rows = query.fetch_all(self.pool.as_ref()).await?;
            for row in rows {
                let message_id: String = row.get("message_id");
                let attachment = FileAttachment {
                    id: row.get("id"),
                    file_name: row.get("file_name"),
                    file_size: row.get("file_size"),
                    mime_type: row.get("mime_type"),
                    storage_path: row.get("storage_path"),
                    content_hash: row.get("content_hash"),
                    created_at: row.get("created_at"),
                };
                by_message
                    .entry(message_id)
                    .or_default()
                    .push(UserAttachment::File(attachment));
            }
        }
        Ok(by_message)
    }

    pub async fn unlink_message_attachment(
        &self,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "message_attachments",
            "message_id = ?2 AND attachment_id = ?3 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(message_id)
        .bind(attachment_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CreateMessageRequest;

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    async fn message(db: &Database, content: &str) -> String {
        db.create_message(CreateMessageRequest {
            conversation_id: None,
            sender_type: "user".to_string(),
            sender_id: None,
            content: content.to_string(),
            tokens: None,
        })
        .await
        .unwrap()
        .id
    }

    async fn file(db: &Database, name: &str, hash: &str) -> String {
        db.create_file_attachment(CreateFileAttachmentRequest {
            file_name: name.to_string(),
            file_size: 4,
            mime_type: "text/plain".to_string(),
            storage_path: format!("files/{hash}.txt"),
            content_hash: hash.to_string(),
        })
        .await
        .unwrap()
        .id
    }

    #[tokio::test]
    async fn batch_attachments_group_by_message() {
        let (db, _dir) = test_db().await;
        let m1 = message(&db, "one").await;
        let m2 = message(&db, "two").await;
        let f1 = file(&db, "a.txt", "h1").await;
        let f2 = file(&db, "b.txt", "h2").await;

        db.link_message_attachment(&m1, &f1, Some(0)).await.unwrap();
        db.link_message_attachment(&m2, &f2, Some(0)).await.unwrap();

        let map = db
            .get_message_attachments_batch(&[m1.clone(), m2.clone()])
            .await
            .unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(map[&m1].len(), 1);
        assert_eq!(map[&m2].len(), 1);
        assert!(
            db.get_message_attachments_batch(&[])
                .await
                .unwrap()
                .is_empty()
        );
    }
}
