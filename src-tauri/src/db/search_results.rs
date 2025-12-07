use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateSearchResultRequest, SearchResult};

impl Database {
    pub async fn create_search_result(
        &self,
        req: CreateSearchResultRequest,
    ) -> Result<SearchResult> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO search_results (id, query, engine, total_results, searched_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
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
             FROM search_results WHERE id = ?",
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

    pub async fn update_search_result_total(
        &self,
        id: &str,
        total_results: i64,
    ) -> Result<SearchResult> {
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
}

