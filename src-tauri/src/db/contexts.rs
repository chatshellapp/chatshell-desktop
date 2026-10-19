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
             WHERE message_contexts.deleted_at IS NULL AND message_id = ?
             ORDER BY display_order, created_at",
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        for row in rows {
            let context_type: String = row.get("context_type");
            let context_id: String = row.get("context_id");
            let display_order: i32 = row.get("display_order");

            if context_type == "fetch_result"
                && let Ok(fetch_result) = self.get_fetch_result(&context_id).await
            {
                contexts.push((
                    display_order,
                    fetch_result.created_at.clone(),
                    ContextEnrichment::FetchResult(Box::new(fetch_result)),
                ));
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
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "message_contexts",
            "message_id = ?2 AND context_type = ?3 AND context_id = ?4 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(message_id)
        .bind(context_type.to_string())
        .bind(context_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        CreateFetchResultRequest, CreateMessageRequest, CreateSearchResultRequest,
    };

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

    async fn fetch_result(db: &Database, url: &str, hash: &str) -> crate::models::FetchResult {
        db.create_fetch_result(CreateFetchResultRequest {
            source_type: None,
            source_id: None,
            url: url.to_string(),
            title: Some("A title".to_string()),
            description: None,
            storage_path: format!("fetch/{hash}.md"),
            content_type: "text/markdown".to_string(),
            original_mime: None,
            status: Some("success".to_string()),
            error: None,
            keywords: None,
            headings: None,
            original_size: None,
            processed_size: None,
            favicon_url: None,
            content_hash: Some(hash.to_string()),
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn link_and_get_fetch_context_roundtrip() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let other = message(&db, "other message").await;
        let fetch = fetch_result(&db, "https://example.com/a", "hash-a").await;

        db.link_message_context(&m, ContextType::FetchResult, &fetch.id, Some(0))
            .await
            .unwrap();

        let contexts = db.get_message_contexts(&m).await.unwrap();
        assert_eq!(contexts.len(), 1);
        assert_eq!(contexts[0].id(), fetch.id);
        assert_eq!(contexts[0].context_type(), ContextType::FetchResult);
        assert!(
            matches!(contexts[0], ContextEnrichment::FetchResult(_)),
            "junction rows hydrate into FetchResult enrichments"
        );

        assert!(db.get_message_contexts(&other).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn unlink_removes_context_and_missing_unlink_is_noop() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let fetch = fetch_result(&db, "https://example.com/a", "hash-a").await;

        db.link_message_context(&m, ContextType::FetchResult, &fetch.id, Some(0))
            .await
            .unwrap();
        assert_eq!(db.get_message_contexts(&m).await.unwrap().len(), 1);

        db.unlink_message_context(&m, ContextType::FetchResult, &fetch.id)
            .await
            .unwrap();
        assert!(db.get_message_contexts(&m).await.unwrap().is_empty());

        // Unlinking again (nothing left to tombstone) stays Ok: no-op.
        db.unlink_message_context(&m, ContextType::FetchResult, &fetch.id)
            .await
            .unwrap();
        assert!(db.get_message_contexts(&m).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn search_results_via_direct_fk_ordered_with_linked_fetch_results() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let fetch_low = fetch_result(&db, "https://example.com/low", "h-low").await;
        let fetch_high = fetch_result(&db, "https://example.com/high", "h-high").await;

        db.link_message_context(&m, ContextType::FetchResult, &fetch_low.id, Some(1))
            .await
            .unwrap();
        db.link_message_context(&m, ContextType::FetchResult, &fetch_high.id, Some(9))
            .await
            .unwrap();
        let search = db
            .create_search_result(CreateSearchResultRequest {
                message_id: m.clone(),
                query: "rust sqlite".to_string(),
                engine: "duckduckgo".to_string(),
                total_results: Some(3),
                display_order: Some(5),
                searched_at: "2026-01-01T00:00:00Z".to_string(),
            })
            .await
            .unwrap();

        let contexts = db.get_message_contexts(&m).await.unwrap();
        assert_eq!(
            contexts
                .iter()
                .map(|c| c.id().to_string())
                .collect::<Vec<_>>(),
            vec![
                fetch_low.id.clone(),
                search.id.clone(),
                fetch_high.id.clone()
            ],
            "merged contexts sort by display_order across both sources"
        );
        assert!(
            contexts
                .iter()
                .any(|c| matches!(c, ContextEnrichment::SearchResult(_)))
        );
    }

    #[tokio::test]
    async fn linking_search_result_type_is_ignored_by_junction() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let search = db
            .create_search_result(CreateSearchResultRequest {
                message_id: m.clone(),
                query: "junction".to_string(),
                engine: "duckduckgo".to_string(),
                total_results: None,
                display_order: None,
                searched_at: "2026-01-01T00:00:00Z".to_string(),
            })
            .await
            .unwrap();

        // The junction CHECK only allows 'fetch_result'; INSERT OR IGNORE
        // skips the row instead of erroring.
        db.link_message_context(&m, ContextType::SearchResult, &search.id, Some(0))
            .await
            .unwrap();

        let contexts = db.get_message_contexts(&m).await.unwrap();
        assert_eq!(
            contexts.len(),
            1,
            "search result appears once, via its direct FK, not twice"
        );
        assert_eq!(contexts[0].id(), search.id);
    }
}
