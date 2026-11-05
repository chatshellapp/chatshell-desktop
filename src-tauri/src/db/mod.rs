mod assistants;
mod attachments;
pub mod compactions;
mod contexts;
mod conversation_settings;
mod conversations;
mod fetch_results;
mod key_repair;
mod messages;
mod model_parameter_presets;
mod models;
mod prompt_history;
mod prompts;
mod providers;
mod schema;
mod search_results;
mod seed;
mod settings;
pub mod skills;
pub mod soft_delete;
mod steps;
pub mod system_ids;
pub mod tools;
mod translation_history;
mod users;

use anyhow::Result;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Clone)]
pub struct Database {
    /// The canonical database. Published whole (`VACUUM INTO`) as the sync
    /// snapshot, so everything in it travels to other devices.
    pool: Arc<SqlitePool>,
    /// Device-local database for data that must never leave this device
    /// (input and translation history). A separate file, so it is never part
    /// of the snapshot.
    local_pool: Arc<SqlitePool>,
}

/// Path of the device-local database that accompanies `db_path`:
/// `data.db` -> `data.local.db`, in the same directory.
pub fn local_db_path(db_path: &Path) -> PathBuf {
    let stem = db_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("data");
    db_path.with_file_name(format!("{stem}.local.db"))
}

async fn open_pool(path: &str) -> Result<SqlitePool> {
    Ok(SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&format!("sqlite:{}?mode=rwc", path))
        .await?)
}

impl Database {
    pub async fn new(db_path: &str) -> Result<Self> {
        let local_path = local_db_path(Path::new(db_path));
        let local_path = local_path
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("invalid local database path"))?;

        let db = Database {
            pool: Arc::new(open_pool(db_path).await?),
            local_pool: Arc::new(open_pool(local_path).await?),
        };

        schema::init_schema(&db.pool).await?;
        schema::init_local_schema(&db.local_pool).await?;

        // Initialize encryption key for API key storage (stored in OS keychain)
        // This gracefully falls back to an ephemeral key if keychain access is denied
        crate::crypto::init_encryption_key();

        // Ensure default parameter presets exist
        db.ensure_default_presets().await?;
        // Move input history out of the synced database (v0.8.3-v0.9.2
        // layout). Best-effort: a failure leaves the legacy table for the
        // next launch and must not block startup.
        if let Err(e) = db.migrate_legacy_prompt_history().await {
            tracing::warn!("Failed to migrate legacy input history: {e:#}");
        }
        // Backfill global input history from existing user messages once
        db.ensure_prompt_history_seeded().await?;

        // Ensure builtin tools exist (web_search, web_fetch)
        db.ensure_builtin_tools().await?;

        Ok(db)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub fn local_pool(&self) -> &SqlitePool {
        &self.local_pool
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_db_sits_next_to_the_canonical_db() {
        assert_eq!(
            local_db_path(Path::new("/app/data.db")),
            PathBuf::from("/app/data.local.db")
        );
        assert_eq!(
            local_db_path(Path::new("/tmp/t.sqlite")),
            PathBuf::from("/tmp/t.local.db")
        );
    }
}
