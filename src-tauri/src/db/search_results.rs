use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateSearchResultRequest, SearchResult, SearchResultItem};

impl Database {
    pub async fn create_search_result(
        &self,
        req: CreateSearchResultRequest,
    ) -> Result<SearchResult> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let display_order = req.display_order.unwrap_or(0);

        sqlx::query(
            "INSERT INTO search_results (id, message_id, query, engine, total_results, display_order, searched_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.message_id)
        .bind(&req.query)
        .bind(&req.engine)
        .bind(req.total_results)
        .bind(display_order)
        .bind(&req.searched_at)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_search_result(&id).await
    }

    pub async fn get_search_result(&self, id: &str) -> Result<SearchResult> {
        let row = sqlx::query(
            "SELECT id, message_id, query, engine, total_results, display_order, searched_at, created_at
             FROM search_results WHERE search_results.deleted_at IS NULL AND id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Search result not found: {}", id))?;

        Ok(SearchResult {
            id: row.get("id"),
            message_id: row.get("message_id"),
            query: row.get("query"),
            engine: row.get("engine"),
            total_results: row.get("total_results"),
            display_order: row.get("display_order"),
            searched_at: row.get("searched_at"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn get_search_results_by_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<SearchResult>> {
        let rows = sqlx::query(
            "SELECT id, message_id, query, engine, total_results, display_order, searched_at, created_at
             FROM search_results WHERE search_results.deleted_at IS NULL AND message_id = ? ORDER BY display_order, created_at",
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows
            .iter()
            .map(|row| SearchResult {
                id: row.get("id"),
                message_id: row.get("message_id"),
                query: row.get("query"),
                engine: row.get("engine"),
                total_results: row.get("total_results"),
                display_order: row.get("display_order"),
                searched_at: row.get("searched_at"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    pub async fn update_search_result_total(
        &self,
        id: &str,
        total_results: i64,
    ) -> Result<SearchResult> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE search_results SET total_results = ?, updated_at = ? WHERE id = ?")
            .bind(total_results)
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        self.get_search_result(id).await
    }

    pub async fn delete_search_result(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "search_results",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    /// Persist the search-engine result entries for a search. Written once
    /// per search; the items are the snapshot the model saw.
    pub async fn update_search_result_items(
        &self,
        id: &str,
        items: &[SearchResultItem],
    ) -> Result<()> {
        let json = serde_json::to_string(items)?;
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE search_results SET items_json = ?, total_results = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&json)
        .bind(items.len() as i64)
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    /// SERP entries for a search, oldest-first order preserved. A missing or
    /// unparseable column yields an empty list: the preview degrades to the
    /// result count instead of failing.
    pub async fn get_search_result_items(&self, id: &str) -> Result<Vec<SearchResultItem>> {
        let row = sqlx::query(
            "SELECT items_json FROM search_results WHERE search_results.deleted_at IS NULL AND id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        let Some(row) = row else {
            return Ok(Vec::new());
        };
        let raw: Option<String> = row.get("items_json");
        Ok(raw
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default())
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

    fn search_req(
        message_id: &str,
        query: &str,
        display_order: Option<i32>,
    ) -> CreateSearchResultRequest {
        CreateSearchResultRequest {
            message_id: message_id.to_string(),
            query: query.to_string(),
            engine: "duckduckgo".to_string(),
            total_results: Some(7),
            display_order,
            searched_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[tokio::test]
    async fn create_and_get_roundtrip() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let created = db
            .create_search_result(search_req(&m, "rust sqlx", Some(2)))
            .await
            .unwrap();

        assert_eq!(created.message_id, m);
        assert_eq!(created.query, "rust sqlx");
        assert_eq!(created.engine, "duckduckgo");
        assert_eq!(created.total_results, Some(7));
        assert_eq!(created.display_order, 2);
        assert_eq!(created.searched_at, "2026-01-01T00:00:00Z");
        assert!(!created.created_at.is_empty());

        let fetched = db.get_search_result(&created.id).await.unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.query, created.query);
        assert_eq!(fetched.total_results, created.total_results);
    }

    #[tokio::test]
    async fn create_applies_defaults_for_totals_and_order() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let created = db
            .create_search_result(search_req(&m, "defaults", None))
            .await
            .unwrap();
        assert_eq!(created.total_results, Some(7));
        assert_eq!(created.display_order, 0);
    }

    #[tokio::test]
    async fn get_missing_returns_err() {
        let (db, _dir) = test_db().await;
        assert!(db.get_search_result("no-such-id").await.is_err());
    }

    #[tokio::test]
    async fn by_message_orders_by_display_order_and_filters() {
        let (db, _dir) = test_db().await;
        let m1 = message(&db, "message one").await;
        let m2 = message(&db, "message two").await;
        let first = db
            .create_search_result(search_req(&m1, "first", Some(1)))
            .await
            .unwrap();
        let second = db
            .create_search_result(search_req(&m1, "second", Some(0)))
            .await
            .unwrap();
        let other = db
            .create_search_result(search_req(&m2, "other", Some(0)))
            .await
            .unwrap();

        let results = db.get_search_results_by_message(&m1).await.unwrap();
        assert_eq!(
            results.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec![second.id.as_str(), first.id.as_str()],
            "ordered by display_order"
        );

        let results = db.get_search_results_by_message(&m2).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, other.id);

        assert!(
            db.get_search_results_by_message("no-such-message")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn update_total_persists_and_returns_row() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let created = db
            .create_search_result(search_req(&m, "totals", None))
            .await
            .unwrap();

        let updated = db
            .update_search_result_total(&created.id, 42)
            .await
            .unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.total_results, Some(42));

        let fetched = db.get_search_result(&created.id).await.unwrap();
        assert_eq!(fetched.total_results, Some(42));
    }

    #[tokio::test]
    async fn items_json_roundtrip_preserves_order_and_updates_total() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let created = db
            .create_search_result(search_req(&m, "items", None))
            .await
            .unwrap();

        // No items persisted yet: NULL column degrades to an empty list.
        assert!(
            db.get_search_result_items(&created.id)
                .await
                .unwrap()
                .is_empty()
        );

        let items = vec![
            SearchResultItem {
                title: "First".to_string(),
                url: "https://example.com/1".to_string(),
                snippet: "snippet one".to_string(),
            },
            SearchResultItem {
                title: "Second".to_string(),
                url: "https://example.com/2".to_string(),
                snippet: "snippet two".to_string(),
            },
            SearchResultItem {
                title: "Third".to_string(),
                url: "https://example.com/3".to_string(),
                snippet: "snippet three".to_string(),
            },
        ];
        db.update_search_result_items(&created.id, &items)
            .await
            .unwrap();

        assert_eq!(
            db.get_search_result_items(&created.id).await.unwrap(),
            items
        );
        let fetched = db.get_search_result(&created.id).await.unwrap();
        assert_eq!(fetched.total_results, Some(3));

        // Overwriting with an empty snapshot clears items and the total.
        db.update_search_result_items(&created.id, &[])
            .await
            .unwrap();
        assert!(
            db.get_search_result_items(&created.id)
                .await
                .unwrap()
                .is_empty()
        );
        let fetched = db.get_search_result(&created.id).await.unwrap();
        assert_eq!(fetched.total_results, Some(0));

        // Missing id: no row to read, degrades to an empty list.
        assert!(
            db.get_search_result_items("no-such-id")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn delete_soft_deletes_row_from_all_reads() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let created = db
            .create_search_result(search_req(&m, "doomed", None))
            .await
            .unwrap();

        db.delete_search_result(&created.id).await.unwrap();

        assert!(db.get_search_result(&created.id).await.is_err());
        assert!(
            db.get_search_results_by_message(&m)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            db.get_search_result_items(&created.id)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn deleting_message_row_cascades_to_search_results() {
        let (db, _dir) = test_db().await;
        let m = message(&db, "message").await;
        let created = db
            .create_search_result(search_req(&m, "cascade", None))
            .await
            .unwrap();

        sqlx::query("DELETE FROM messages WHERE id = ?")
            .bind(&m)
            .execute(db.pool())
            .await
            .unwrap();

        assert!(
            db.get_search_results_by_message(&m)
                .await
                .unwrap()
                .is_empty(),
            "ON DELETE CASCADE removes search results with their message"
        );
        assert!(
            db.get_search_result(&created.id).await.is_err(),
            "cascade is a hard delete, not a soft one"
        );
    }
}
