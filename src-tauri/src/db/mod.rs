mod providers;
mod models;
mod assistants;
mod users;
mod conversations;
mod messages;
mod attachments;
mod contexts;
mod fetch_results;
mod search_results;
mod steps;
mod settings;
mod seed;
mod schema;

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
        
        Ok(db)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}
