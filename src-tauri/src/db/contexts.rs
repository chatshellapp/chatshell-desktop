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
        let mut contexts: Vec<(i32, String, ContextEnrichment)> = Vec::new();

        // Get search results directly (via FK, not junction table)
        for search_result in self.get_search_results_by_message(message_id).await? {
            contexts.push((
                search_result.display_order,
                search_result.created_at.clone(),
                ContextEnrichment::SearchResult(search_result),
            ));
        }

        // Get fetch results via junction table
        let rows = sqlx::query(
            "SELECT context_type, context_id, display_order
             FROM message_contexts
             WHERE message_id = ?
             ORDER BY display_order, created_at",
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        for row in rows {
            let context_type: String = row.get("context_type");
            let context_id: String = row.get("context_id");
            let display_order: i32 = row.get("display_order");

            if context_type == "fetch_result" {
                if let Ok(fetch_result) = self.get_fetch_result(&context_id).await {
                    contexts.push((
                        display_order,
                        fetch_result.created_at.clone(),
                        ContextEnrichment::FetchResult(fetch_result),
                    ));
                }
            }
        }

        // Sort by display_order, then by created_at
        contexts.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        Ok(contexts.into_iter().map(|(_, _, c)| c).collect())
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
