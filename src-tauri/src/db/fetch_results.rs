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
            "SELECT {} FROM fetch_results WHERE id = ?",
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
            "SELECT {} FROM fetch_results WHERE content_hash = ? LIMIT 1",
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
            "SELECT {} FROM fetch_results WHERE source_type = ? AND source_id = ? ORDER BY created_at",
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
             WHERE mc.message_id = ?
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
        sqlx::query("DELETE FROM fetch_results WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }
}
