use anyhow::Result;
use chrono::Utc;
use sqlx::Row;

use super::Database;
use crate::models::Setting;
use crate::web_search::SearchProvider;

impl Database {
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(self.pool.as_ref())
            .await?;

        Ok(row.map(|(value,)| value))
    }

    /// Get the user-configured web search provider (falls back to the default).
    pub async fn get_search_provider(&self) -> SearchProvider {
        self.get_setting("search_provider")
            .await
            .ok()
            .flatten()
            .and_then(|id| SearchProvider::from_id(&id))
            .unwrap_or_default()
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();

        sqlx::query("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
            .bind(key)
            .bind(value)
            .bind(&now)
            .execute(self.pool.as_ref())
            .await?;

        Ok(())
    }

    pub async fn get_all_settings(&self) -> Result<Vec<Setting>> {
        let rows = sqlx::query("SELECT key, value, updated_at FROM settings ORDER BY key")
            .fetch_all(self.pool.as_ref())
            .await?;

        let settings = rows
            .iter()
            .map(|row| Setting {
                key: row.get("key"),
                value: row.get("value"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    #[tokio::test]
    async fn search_provider_defaults_to_duckduckgo_when_unset() {
        let (db, _dir) = test_db().await;
        assert_eq!(db.get_search_provider().await, SearchProvider::DuckDuckGo);
    }

    #[tokio::test]
    async fn saved_search_provider_round_trips() {
        let (db, _dir) = test_db().await;
        for (id, expected) in [
            ("yahoo", SearchProvider::Yahoo),
            ("baidu", SearchProvider::Baidu),
            ("duckduckgo", SearchProvider::DuckDuckGo),
        ] {
            db.set_setting("search_provider", id).await.unwrap();
            assert_eq!(db.get_search_provider().await, expected);
        }
    }

    #[tokio::test]
    async fn invalid_search_provider_falls_back_to_default() {
        let (db, _dir) = test_db().await;
        db.set_setting("search_provider", "altavista")
            .await
            .unwrap();
        assert_eq!(db.get_search_provider().await, SearchProvider::DuckDuckGo);
    }
}
