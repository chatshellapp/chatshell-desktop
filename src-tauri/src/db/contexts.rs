use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{ContextEnrichment, ContextType};

impl Database {
    pub async fn link_message_context(
        &self,
        message_id: &str,
        context_type: ContextType,
        context_id: &str,
        display_order: Option<i32>,
    ) -> Result<()> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let order = display_order.unwrap_or(0);

        sqlx::query(
            "INSERT OR IGNORE INTO message_contexts
             (id, message_id, context_type, context_id, display_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(message_id)
        .bind(context_type.to_string())
        .bind(context_id)
        .bind(order)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }

    pub async fn get_message_contexts(&self, message_id: &str) -> Result<Vec<ContextEnrichment>> {
        let rows = sqlx::query(
            "SELECT context_type, context_id, display_order
             FROM message_contexts
             WHERE message_id = ?
             ORDER BY display_order, created_at",
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut contexts = Vec::new();
        for row in rows {
            let context_type: String = row.get("context_type");
            let context_id: String = row.get("context_id");

            let context = match context_type.as_str() {
                "search_result" => self
                    .get_search_result(&context_id)
                    .await
                    .map(ContextEnrichment::SearchResult)
                    .ok(),
                "fetch_result" => self
                    .get_fetch_result(&context_id)
                    .await
                    .map(ContextEnrichment::FetchResult)
                    .ok(),
                _ => None,
            };
            if let Some(c) = context {
                contexts.push(c);
            }
        }

        Ok(contexts)
    }

    pub async fn unlink_message_context(
        &self,
        message_id: &str,
        context_type: ContextType,
        context_id: &str,
    ) -> Result<()> {
        sqlx::query(
            "DELETE FROM message_contexts WHERE message_id = ? AND context_type = ? AND context_id = ?",
        )
        .bind(message_id)
        .bind(context_type.to_string())
        .bind(context_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}
