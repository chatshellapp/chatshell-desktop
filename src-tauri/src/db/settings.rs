use anyhow::Result;
use chrono::Utc;
use sqlx::Row;

use super::Database;
use crate::models::Setting;

impl Database {
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(self.pool.as_ref())
            .await?;

        Ok(row.map(|(value,)| value))
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
