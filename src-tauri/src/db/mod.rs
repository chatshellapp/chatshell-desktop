mod assistants;
mod attachments;
mod contexts;
mod conversations;
mod fetch_results;
mod messages;
mod model_parameter_presets;
mod models;
mod prompts;
mod providers;
mod schema;
mod search_results;
mod seed;
mod settings;
mod steps;
mod users;

use anyhow::Result;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::sync::Arc;

#[derive(Clone)]
pub struct Database {
    pool: Arc<SqlitePool>,
}

impl Database {
    pub async fn new(db_path: &str) -> Result<Self> {
        let db_url = format!("sqlite:{}?mode=rwc", db_path);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await?;

        let db = Database {
            pool: Arc::new(pool),
        };

        schema::init_schema(&db.pool).await?;

        // Initialize encryption key for API key storage
        crate::crypto::init_encryption_key(&db).await?;

        // Ensure default parameter presets exist
        db.ensure_default_presets().await?;

        Ok(db)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}
