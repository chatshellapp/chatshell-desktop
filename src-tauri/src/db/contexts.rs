use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{
    ContextEnrichment, ContextType, CreateFetchResultRequest, CreateSearchResultRequest,
    FetchResult, SearchResult,
};

impl Database {
    // Search Result operations
    pub async fn create_search_result(&self, req: CreateSearchResultRequest) -> Result<SearchResult> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO search_results (id, query, engine, total_results, searched_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.query)
        .bind(&req.engine)
        .bind(req.total_results)
        .bind(&req.searched_at)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_search_result(&id).await
    }

    pub async fn get_search_result(&self, id: &str) -> Result<SearchResult> {
        let row = sqlx::query(
            "SELECT id, query, engine, total_results, searched_at, created_at
             FROM search_results WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Search result not found: {}", id))?;

        Ok(SearchResult {
            id: row.get("id"),
            query: row.get("query"),
            engine: row.get("engine"),
            total_results: row.get("total_results"),
            searched_at: row.get("searched_at"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn update_search_result_total(&self, id: &str, total_results: i64) -> Result<SearchResult> {
        sqlx::query("UPDATE search_results SET total_results = ? WHERE id = ?")
            .bind(total_results)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        self.get_search_result(id).await
    }

    pub async fn delete_search_result(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM search_results WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // Fetch Result operations
    pub async fn create_fetch_result(&self, req: CreateFetchResultRequest) -> Result<FetchResult> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let status = req.status.unwrap_or_else(|| "pending".to_string());
        let source_type = req.source_type.unwrap_or_else(|| "search".to_string());

        sqlx::query(
            "INSERT INTO fetch_results 
             (id, source_type, source_id, url, title, description, storage_path, content_type, original_mime,
              status, error, keywords, headings, original_size, processed_size, favicon_url, content_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        let row = sqlx::query(
            "SELECT id, source_type, source_id, url, title, description, storage_path, content_type, original_mime,
                    status, error, keywords, headings, original_size, processed_size, favicon_url, content_hash, created_at, updated_at
             FROM fetch_results WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Fetch result not found: {}", id))?;

        let status: Option<String> = row.get("status");

        Ok(FetchResult {
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
        })
    }

    pub async fn find_fetch_by_hash(&self, content_hash: &str) -> Result<Option<FetchResult>> {
        let row = sqlx::query(
            "SELECT id, source_type, source_id, url, title, description, storage_path, content_type, original_mime,
                    status, error, keywords, headings, original_size, processed_size, favicon_url, content_hash, created_at, updated_at
             FROM fetch_results WHERE content_hash = ? LIMIT 1"
        )
        .bind(content_hash)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => {
                let status: Option<String> = row.get("status");

                Ok(Some(FetchResult {
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
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn get_fetch_results_by_source(
        &self,
        source_type: &str,
        source_id: &str,
    ) -> Result<Vec<FetchResult>> {
        let rows = sqlx::query(
            "SELECT id, source_type, source_id, url, title, description, storage_path, content_type, original_mime,
                    status, error, keywords, headings, original_size, processed_size, favicon_url, content_hash, created_at, updated_at
             FROM fetch_results WHERE source_type = ? AND source_id = ?
             ORDER BY created_at"
        )
        .bind(source_type)
        .bind(source_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let results = rows
            .iter()
            .map(|row| {
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
            })
            .collect();

        Ok(results)
    }

    pub async fn get_fetch_results_by_message(&self, message_id: &str) -> Result<Vec<FetchResult>> {
        let rows = sqlx::query(
            "SELECT f.id, f.source_type, f.source_id, f.url, f.title, f.description, f.storage_path, f.content_type, f.original_mime,
                    f.status, f.error, f.keywords, f.headings, f.original_size, f.processed_size, f.favicon_url, f.content_hash, f.created_at, f.updated_at
             FROM fetch_results f
             INNER JOIN message_contexts mc ON mc.context_id = f.id AND mc.context_type = 'fetch_result'
             WHERE mc.message_id = ?
             ORDER BY mc.display_order, mc.created_at"
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let results = rows
            .iter()
            .map(|row| {
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
            })
            .collect();

        Ok(results)
    }

    pub async fn update_fetch_result_status(
        &self,
        id: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE fetch_results SET status = ?, error = ?, updated_at = ? WHERE id = ?"
        )
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

    // Message Context Link operations
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
             VALUES (?, ?, ?, ?, ?, ?)"
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
             ORDER BY display_order, created_at"
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
            "DELETE FROM message_contexts WHERE message_id = ? AND context_type = ? AND context_id = ?"
        )
        .bind(message_id)
        .bind(context_type.to_string())
        .bind(context_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}

