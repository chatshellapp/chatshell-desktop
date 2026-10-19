use anyhow::Result;
use chrono::Utc;
use sqlx::{Row, sqlite::SqliteRow};
use uuid::Uuid;

use super::Database;
use crate::models::{CreateFetchResultRequest, FetchResult};

/// Maps a database row to a FetchResult struct.
/// Used by all fetch result query methods to avoid code duplication.
fn map_fetch_result_row(row: &SqliteRow) -> FetchResult {
    let status: Option<String> = row.get("status");

    FetchResult {
        id: row.get("id"),
        source_type: row.get("source_type"),
        source_id: row.get("source_id"),
        url: row.get("url"),
        title: row.get("title"),
        description: row.get("description"),
        storage_path: row.get("storage_path"),
        content_type: row.get("content_type"),
        original_mime: row.get("original_mime"),
        status: status.unwrap_or_else(|| "pending".to_string()),
        error: row.get("error"),
        keywords: row.get("keywords"),
        headings: row.get("headings"),
        original_size: row.get("original_size"),
        processed_size: row.get("processed_size"),
        favicon_url: row.get("favicon_url"),
        content_hash: row.get("content_hash"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

const FETCH_RESULT_COLUMNS: &str = "id, source_type, source_id, url, title, description, storage_path, content_type, original_mime, status, error, keywords, headings, original_size, processed_size, favicon_url, content_hash, created_at, updated_at";

impl Database {
    pub async fn create_fetch_result(&self, req: CreateFetchResultRequest) -> Result<FetchResult> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let status = req.status.unwrap_or_else(|| "pending".to_string());
        let source_type = req.source_type.unwrap_or_else(|| "search".to_string());

        sqlx::query(
            "INSERT INTO fetch_results
             (id, source_type, source_id, url, title, description, storage_path, content_type, original_mime,
              status, error, keywords, headings, original_size, processed_size, favicon_url, content_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&source_type)
        .bind(&req.source_id)
        .bind(&req.url)
        .bind(&req.title)
        .bind(&req.description)
        .bind(&req.storage_path)
        .bind(&req.content_type)
        .bind(&req.original_mime)
        .bind(&status)
        .bind(&req.error)
        .bind(&req.keywords)
        .bind(&req.headings)
        .bind(req.original_size)
        .bind(req.processed_size)
        .bind(&req.favicon_url)
        .bind(&req.content_hash)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_fetch_result(&id).await
    }

    pub async fn get_fetch_result(&self, id: &str) -> Result<FetchResult> {
        let query = format!(
            "SELECT {} FROM fetch_results WHERE fetch_results.deleted_at IS NULL AND id = ?",
            FETCH_RESULT_COLUMNS
        );

        let row = sqlx::query(&query)
            .bind(id)
            .fetch_optional(self.pool.as_ref())
            .await?
            .ok_or_else(|| anyhow::anyhow!("Fetch result not found: {}", id))?;

        Ok(map_fetch_result_row(&row))
    }

    pub async fn find_fetch_by_hash(&self, content_hash: &str) -> Result<Option<FetchResult>> {
        let query = format!(
            "SELECT {} FROM fetch_results WHERE fetch_results.deleted_at IS NULL AND content_hash = ? LIMIT 1",
            FETCH_RESULT_COLUMNS
        );

        let row = sqlx::query(&query)
            .bind(content_hash)
            .fetch_optional(self.pool.as_ref())
            .await?;

        Ok(row.as_ref().map(map_fetch_result_row))
    }

    pub async fn get_fetch_results_by_source(
        &self,
        source_type: &str,
        source_id: &str,
    ) -> Result<Vec<FetchResult>> {
        let query = format!(
            "SELECT {} FROM fetch_results WHERE fetch_results.deleted_at IS NULL AND source_type = ? AND source_id = ? ORDER BY created_at",
            FETCH_RESULT_COLUMNS
        );

        let rows = sqlx::query(&query)
            .bind(source_type)
            .bind(source_id)
            .fetch_all(self.pool.as_ref())
            .await?;

        Ok(rows.iter().map(map_fetch_result_row).collect())
    }

    pub async fn get_fetch_results_by_message(&self, message_id: &str) -> Result<Vec<FetchResult>> {
        // Use explicit table-qualified column names to avoid ambiguity with message_contexts
        let query =
            "SELECT f.id, f.source_type, f.source_id, f.url, f.title, f.description,
                    f.storage_path, f.content_type, f.original_mime, f.status, f.error,
                    f.keywords, f.headings, f.original_size, f.processed_size,
                    f.favicon_url, f.content_hash, f.created_at, f.updated_at
             FROM fetch_results f
             INNER JOIN message_contexts mc ON mc.context_id = f.id AND mc.context_type = 'fetch_result'
             WHERE mc.deleted_at IS NULL AND f.deleted_at IS NULL AND mc.message_id = ?
             ORDER BY mc.display_order, mc.created_at";

        let rows = sqlx::query(query)
            .bind(message_id)
            .fetch_all(self.pool.as_ref())
            .await?;

        Ok(rows.iter().map(map_fetch_result_row).collect())
    }

    pub async fn update_fetch_result_status(
        &self,
        id: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE fetch_results SET status = ?, error = ?, updated_at = ? WHERE id = ?")
            .bind(status)
            .bind(error)
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    pub async fn delete_fetch_result(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "fetch_results",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ContextType, CreateMessageRequest};

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

    fn fetch_req(url: &str, hash: &str) -> CreateFetchResultRequest {
        CreateFetchResultRequest {
            source_type: Some("search".to_string()),
            source_id: Some("sr-1".to_string()),
            url: url.to_string(),
            title: Some("A title".to_string()),
            description: Some("A description".to_string()),
            storage_path: format!("fetch/{hash}.md"),
            content_type: "text/markdown".to_string(),
            original_mime: Some("text/html".to_string()),
            status: Some("success".to_string()),
            error: None,
            keywords: Some("rust, sqlx".to_string()),
            headings: Some(r#"["Intro","Details"]"#.to_string()),
            original_size: Some(1024),
            processed_size: Some(512),
            favicon_url: Some("https://example.com/favicon.ico".to_string()),
            content_hash: Some(hash.to_string()),
        }
    }

    #[tokio::test]
    async fn create_and_get_roundtrip() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_fetch_result(fetch_req("https://example.com/a", "hash-a"))
            .await
            .unwrap();

        assert_eq!(created.source_type, "search");
        assert_eq!(created.source_id.as_deref(), Some("sr-1"));
        assert_eq!(created.url, "https://example.com/a");
        assert_eq!(created.title.as_deref(), Some("A title"));
        assert_eq!(created.description.as_deref(), Some("A description"));
        assert_eq!(created.storage_path, "fetch/hash-a.md");
        assert_eq!(created.content_type, "text/markdown");
        assert_eq!(created.original_mime.as_deref(), Some("text/html"));
        assert_eq!(created.status, "success");
        assert_eq!(created.error, None);
        assert_eq!(created.keywords.as_deref(), Some("rust, sqlx"));
        assert_eq!(created.headings.as_deref(), Some(r#"["Intro","Details"]"#));
        assert_eq!(created.original_size, Some(1024));
        assert_eq!(created.processed_size, Some(512));
        assert_eq!(
            created.favicon_url.as_deref(),
            Some("https://example.com/favicon.ico")
        );
        assert_eq!(created.content_hash.as_deref(), Some("hash-a"));
        assert!(!created.created_at.is_empty());
        assert_eq!(created.updated_at, created.created_at);

        let fetched = db.get_fetch_result(&created.id).await.unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.url, created.url);
        assert_eq!(fetched.content_hash, created.content_hash);
        assert_eq!(fetched.status, created.status);
    }

    #[tokio::test]
    async fn create_applies_defaults_for_source_type_and_status() {
        let (db, _dir) = test_db().await;
        let mut req = fetch_req("https://example.com/default", "hash-d");
        req.source_type = None;
        req.status = None;
        req.source_id = None;

        let created = db.create_fetch_result(req).await.unwrap();
        assert_eq!(created.source_type, "search");
        assert_eq!(created.status, "pending");
        assert_eq!(created.source_id, None);
    }

    #[tokio::test]
    async fn get_missing_returns_err() {
        let (db, _dir) = test_db().await;
        assert!(db.get_fetch_result("no-such-id").await.is_err());
    }

    #[tokio::test]
    async fn find_by_hash_hit_and_miss() {
        let (db, _dir) = test_db().await;
        let a = db
            .create_fetch_result(fetch_req("https://example.com/a", "hash-a"))
            .await
            .unwrap();
        let b = db
            .create_fetch_result(fetch_req("https://example.com/b", "hash-b"))
            .await
            .unwrap();

        let hit = db.find_fetch_by_hash("hash-b").await.unwrap().unwrap();
        assert_eq!(hit.id, b.id);
        let hit = db.find_fetch_by_hash("hash-a").await.unwrap().unwrap();
        assert_eq!(hit.id, a.id);
        assert!(
            db.find_fetch_by_hash("unknown-hash")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn find_by_hash_with_duplicate_hashes_returns_one_row() {
        let (db, _dir) = test_db().await;
        let a = db
            .create_fetch_result(fetch_req("https://example.com/a", "dup-hash"))
            .await
            .unwrap();
        let b = db
            .create_fetch_result(fetch_req("https://example.com/b", "dup-hash"))
            .await
            .unwrap();

        let hit = db.find_fetch_by_hash("dup-hash").await.unwrap().unwrap();
        assert!(hit.id == a.id || hit.id == b.id);
        assert_eq!(hit.content_hash.as_deref(), Some("dup-hash"));
    }

    #[tokio::test]
    async fn by_source_filters_on_type_and_id_and_orders_by_created_at() {
        let (db, _dir) = test_db().await;
        let first = db
            .create_fetch_result(fetch_req("https://example.com/first", "h1"))
            .await
            .unwrap();
        let second = db
            .create_fetch_result(fetch_req("https://example.com/second", "h2"))
            .await
            .unwrap();
        let mut link_req = fetch_req("https://example.com/link", "h3");
        link_req.source_type = Some("user_link".to_string());
        link_req.source_id = Some("s1".to_string());
        let link = db.create_fetch_result(link_req).await.unwrap();

        let results = db
            .get_fetch_results_by_source("search", "sr-1")
            .await
            .unwrap();
        assert_eq!(
            results.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec![first.id.as_str(), second.id.as_str()],
            "same (source_type, source_id), ordered by created_at"
        );

        let results = db
            .get_fetch_results_by_source("user_link", "s1")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, link.id);

        assert!(
            db.get_fetch_results_by_source("search", "other-source")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn by_message_joins_junction_in_display_order() {
        let (db, _dir) = test_db().await;
        let m1 = message(&db, "message one").await;
        let m2 = message(&db, "message two").await;
        let f1 = db
            .create_fetch_result(fetch_req("https://example.com/1", "h1"))
            .await
            .unwrap();
        let f2 = db
            .create_fetch_result(fetch_req("https://example.com/2", "h2"))
            .await
            .unwrap();
        let f3 = db
            .create_fetch_result(fetch_req("https://example.com/3", "h3"))
            .await
            .unwrap();

        db.link_message_context(&m1, ContextType::FetchResult, &f1.id, Some(1))
            .await
            .unwrap();
        db.link_message_context(&m1, ContextType::FetchResult, &f2.id, Some(0))
            .await
            .unwrap();
        db.link_message_context(&m2, ContextType::FetchResult, &f3.id, Some(0))
            .await
            .unwrap();

        let results = db.get_fetch_results_by_message(&m1).await.unwrap();
        assert_eq!(
            results.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec![f2.id.as_str(), f1.id.as_str()],
            "ordered by junction display_order"
        );

        let results = db.get_fetch_results_by_message(&m2).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, f3.id);

        assert!(
            db.get_fetch_results_by_message("no-such-message")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn update_status_transitions_and_missing_update_is_ok() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_fetch_result(fetch_req("https://example.com/a", "hash-a"))
            .await
            .unwrap();
        assert_eq!(created.status, "success");

        db.update_fetch_result_status(&created.id, "processing", None)
            .await
            .unwrap();
        let updated = db.get_fetch_result(&created.id).await.unwrap();
        assert_eq!(updated.status, "processing");
        assert_eq!(updated.error, None);

        db.update_fetch_result_status(&created.id, "failed", Some("boom"))
            .await
            .unwrap();
        let updated = db.get_fetch_result(&created.id).await.unwrap();
        assert_eq!(updated.status, "failed");
        assert_eq!(updated.error.as_deref(), Some("boom"));

        // Fire-and-forget update: a missing id affects zero rows without error.
        db.update_fetch_result_status("no-such-id", "failed", None)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn delete_soft_deletes_row_from_all_reads() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_fetch_result(fetch_req("https://example.com/a", "hash-a"))
            .await
            .unwrap();

        db.delete_fetch_result(&created.id).await.unwrap();

        assert!(db.get_fetch_result(&created.id).await.is_err());
        assert!(db.find_fetch_by_hash("hash-a").await.unwrap().is_none());
        assert!(
            db.get_fetch_results_by_source("search", "sr-1")
                .await
                .unwrap()
                .is_empty()
        );
    }
}
