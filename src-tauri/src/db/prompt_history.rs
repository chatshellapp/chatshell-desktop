use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

use super::Database;

/// Maximum entries kept in the input history; oldest evicted on insert.
const PROMPT_HISTORY_CAP: i64 = 100;

impl Database {
    /// One-time move of input history out of the canonical database.
    ///
    /// v0.8.3 through v0.9.2 kept `prompt_history` in `data.db`, which is
    /// published whole as the sync snapshot, so the history travelled to the
    /// cloud. When the legacy table is present, copy its rows into the
    /// device-local database (unless that was already seeded), then drop it
    /// from the canonical one. The copy commits before the drop, so an
    /// interruption only repeats the drop on the next launch. Runs before
    /// [`Self::ensure_prompt_history_seeded`], which then sees the seeded flag
    /// and keeps the user's exact history instead of rebuilding it.
    pub async fn migrate_legacy_prompt_history(&self) -> Result<()> {
        let legacy: Option<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_history'",
        )
        .fetch_optional(self.pool.as_ref())
        .await?;
        if legacy.is_none() {
            return Ok(());
        }

        let seeded: Option<(String,)> =
            sqlx::query_as("SELECT value FROM local_meta WHERE key = 'prompt_history_seeded'")
                .fetch_optional(self.local_pool.as_ref())
                .await?;
        if seeded.is_none() {
            let rows: Vec<(String, String, String)> = sqlx::query_as(
                "SELECT id, content, created_at FROM prompt_history
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?",
            )
            .bind(PROMPT_HISTORY_CAP)
            .fetch_all(self.pool.as_ref())
            .await?;

            let mut tx = self.local_pool.begin().await?;
            for (id, content, created_at) in &rows {
                sqlx::query(
                    "INSERT OR IGNORE INTO prompt_history (id, content, created_at) VALUES (?, ?, ?)",
                )
                .bind(id)
                .bind(content)
                .bind(created_at)
                .execute(&mut *tx)
                .await?;
            }
            sqlx::query(
                "INSERT OR REPLACE INTO local_meta (key, value, updated_at)
                 VALUES ('prompt_history_seeded', '1', ?)",
            )
            .bind(Utc::now().to_rfc3339())
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            tracing::info!(
                "Moved {} input history entries to the device-local database",
                rows.len()
            );
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("DROP TABLE prompt_history")
            .execute(&mut *tx)
            .await?;
        // The legacy seed flag lived in the canonical `meta` table.
        sqlx::query("DELETE FROM meta WHERE key = 'prompt_history_seeded'")
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// One-time seed: when the global history has never been populated,
    /// backfill it from the most recent distinct user messages (same cap and
    /// newest-first order as live recording). Reads the canonical database and
    /// writes the device-local one; a `local_meta` flag keeps the seed from
    /// re-running after the user clears the history.
    pub async fn ensure_prompt_history_seeded(&self) -> Result<()> {
        let seeded: Option<(String,)> =
            sqlx::query_as("SELECT value FROM local_meta WHERE key = 'prompt_history_seeded'")
                .fetch_optional(self.local_pool.as_ref())
                .await?;
        if seeded.is_some() {
            return Ok(());
        }

        let contents: Vec<(String, String)> = sqlx::query_as(
            "SELECT TRIM(content), MAX(created_at) FROM messages
             WHERE sender_type = 'user' AND TRIM(content) <> ''
             GROUP BY TRIM(content)
             ORDER BY MAX(created_at) DESC, TRIM(content) DESC
             LIMIT ?",
        )
        .bind(PROMPT_HISTORY_CAP)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut tx = self.local_pool.begin().await?;
        for (content, created_at) in contents {
            sqlx::query(
                "INSERT OR IGNORE INTO prompt_history (id, content, created_at) VALUES (?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(content)
            .bind(created_at)
            .execute(&mut *tx)
            .await?;
        }

        sqlx::query(
            "INSERT OR REPLACE INTO local_meta (key, value, updated_at)
             VALUES ('prompt_history_seeded', '1', ?)",
        )
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    /// Record a sent prompt. Move-to-front dedup: an existing entry is
    pub async fn add_prompt_history_entry(&self, content: &str) -> Result<()> {
        let content = content.trim();
        if content.is_empty() {
            return Ok(());
        }

        let now = Utc::now().to_rfc3339();
        let mut tx = self.local_pool.begin().await?;

        sqlx::query(
            "INSERT INTO prompt_history (id, content, created_at)
             VALUES (?, ?, ?)
             ON CONFLICT(content) DO UPDATE SET created_at = excluded.created_at",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(content)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "DELETE FROM prompt_history WHERE id NOT IN (
                SELECT id FROM prompt_history
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?
            )",
        )
        .bind(PROMPT_HISTORY_CAP)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    /// Newest-first history contents (already capped by inserts).
    pub async fn get_prompt_history(&self) -> Result<Vec<String>> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT content FROM prompt_history ORDER BY created_at DESC, id DESC")
                .fetch_all(self.local_pool.as_ref())
                .await?;

        Ok(rows.into_iter().map(|(content,)| content).collect())
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

    #[tokio::test]
    async fn add_returns_newest_first() {
        let (db, _dir) = test_db().await;
        db.add_prompt_history_entry("first").await.unwrap();
        db.add_prompt_history_entry("second").await.unwrap();

        assert_eq!(db.get_prompt_history().await.unwrap(), ["second", "first"]);
    }

    #[tokio::test]
    async fn duplicate_moves_to_front() {
        let (db, _dir) = test_db().await;
        db.add_prompt_history_entry("a").await.unwrap();
        db.add_prompt_history_entry("b").await.unwrap();
        db.add_prompt_history_entry("a").await.unwrap();

        assert_eq!(db.get_prompt_history().await.unwrap(), ["a", "b"]);
    }

    #[tokio::test]
    async fn empty_content_is_ignored() {
        let (db, _dir) = test_db().await;
        db.add_prompt_history_entry("   ").await.unwrap();

        assert_eq!(db.get_prompt_history().await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn cap_evicts_oldest() {
        let (db, _dir) = test_db().await;
        for i in 0..(PROMPT_HISTORY_CAP + 10) {
            db.add_prompt_history_entry(&format!("entry-{i}"))
                .await
                .unwrap();
        }

        let history = db.get_prompt_history().await.unwrap();
        assert_eq!(history.len() as i64, PROMPT_HISTORY_CAP);
        assert_eq!(history.first().unwrap(), "entry-109");
        assert_eq!(history.last().unwrap(), "entry-10");
    }

    #[tokio::test]
    async fn history_lives_outside_the_canonical_database() {
        let (db, _dir) = test_db().await;
        db.add_prompt_history_entry("private prompt").await.unwrap();

        let canonical: Option<(String,)> =
            sqlx::query_as("SELECT name FROM sqlite_master WHERE name = 'prompt_history'")
                .fetch_optional(db.pool())
                .await
                .unwrap();
        assert!(canonical.is_none());
        assert_eq!(db.get_prompt_history().await.unwrap(), ["private prompt"]);
    }

    /// Recreate the v0.8.3-v0.9.2 layout: history in the canonical database
    /// with its seed flag in `meta`, and an unseeded local database.
    async fn install_legacy_history(db: &Database, rows: &[(&str, &str)]) {
        sqlx::query(
            "CREATE TABLE prompt_history (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )",
        )
        .execute(db.pool())
        .await
        .unwrap();
        for (content, created_at) in rows {
            sqlx::query("INSERT INTO prompt_history (id, content, created_at) VALUES (?, ?, ?)")
                .bind(Uuid::now_v7().to_string())
                .bind(content)
                .bind(created_at)
                .execute(db.pool())
                .await
                .unwrap();
        }
        sqlx::query(
            "INSERT OR REPLACE INTO meta (key, value, updated_at)
             VALUES ('prompt_history_seeded', '1', '2026-10-20T00:00:00+00:00')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query("DELETE FROM local_meta")
            .execute(db.local_pool())
            .await
            .unwrap();
        sqlx::query("DELETE FROM prompt_history")
            .execute(db.local_pool())
            .await
            .unwrap();
    }

    async fn canonical_has_history_table(db: &Database) -> bool {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT name FROM sqlite_master WHERE name = 'prompt_history'")
                .fetch_optional(db.pool())
                .await
                .unwrap();
        row.is_some()
    }

    async fn canonical_seed_flag(db: &Database) -> Option<(String,)> {
        sqlx::query_as("SELECT value FROM meta WHERE key = 'prompt_history_seeded'")
            .fetch_optional(db.pool())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn legacy_history_moves_to_local_db_and_leaves_canonical() {
        let (db, _dir) = test_db().await;
        add_message(&db, "user", "unrelated message").await;
        install_legacy_history(
            &db,
            &[
                ("older", "2026-10-20T00:00:00+00:00"),
                ("newer", "2026-10-21T00:00:00+00:00"),
            ],
        )
        .await;

        db.migrate_legacy_prompt_history().await.unwrap();
        // The seed must not replace the moved history with messages
        db.ensure_prompt_history_seeded().await.unwrap();

        assert_eq!(db.get_prompt_history().await.unwrap(), ["newer", "older"]);
        assert!(!canonical_has_history_table(&db).await);
        assert!(canonical_seed_flag(&db).await.is_none());
    }

    #[tokio::test]
    async fn legacy_table_is_dropped_without_copy_when_local_is_seeded() {
        let (db, _dir) = test_db().await;
        install_legacy_history(&db, &[("legacy", "2026-10-20T00:00:00+00:00")]).await;
        db.add_prompt_history_entry("local").await.unwrap();
        sqlx::query(
            "INSERT INTO local_meta (key, value, updated_at)
             VALUES ('prompt_history_seeded', '1', '2026-11-05T00:00:00+00:00')",
        )
        .execute(db.local_pool())
        .await
        .unwrap();

        db.migrate_legacy_prompt_history().await.unwrap();

        assert_eq!(db.get_prompt_history().await.unwrap(), ["local"]);
        assert!(!canonical_has_history_table(&db).await);
    }

    #[tokio::test]
    async fn empty_legacy_table_still_counts_as_seeded() {
        // A user who cleared their history must not get it rebuilt
        let (db, _dir) = test_db().await;
        add_message(&db, "user", "old prompt").await;
        install_legacy_history(&db, &[]).await;

        db.migrate_legacy_prompt_history().await.unwrap();
        db.ensure_prompt_history_seeded().await.unwrap();

        assert!(db.get_prompt_history().await.unwrap().is_empty());
        assert!(!canonical_has_history_table(&db).await);
    }

    #[tokio::test]
    async fn migration_is_a_noop_without_legacy_table() {
        let (db, _dir) = test_db().await;
        db.add_prompt_history_entry("kept").await.unwrap();

        db.migrate_legacy_prompt_history().await.unwrap();
        db.migrate_legacy_prompt_history().await.unwrap();

        assert_eq!(db.get_prompt_history().await.unwrap(), ["kept"]);
    }

    /// End to end through startup: a v0.9.2 database file opened by this
    /// version keeps its history and loses the canonical table.
    #[tokio::test]
    async fn startup_migrates_a_legacy_database_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.db");
        let path = path.to_str().unwrap();
        {
            let db = Database::new(path).await.unwrap();
            install_legacy_history(&db, &[("from v0.9.2", "2026-10-20T00:00:00+00:00")]).await;
            db.pool().close().await;
            db.local_pool().close().await;
        }

        let db = Database::new(path).await.unwrap();

        assert_eq!(db.get_prompt_history().await.unwrap(), ["from v0.9.2"]);
        assert!(!canonical_has_history_table(&db).await);
    }

    async fn rearm_seed(db: &Database) {
        sqlx::query("DELETE FROM local_meta WHERE key = 'prompt_history_seeded'")
            .execute(db.local_pool())
            .await
            .unwrap();
    }

    async fn add_message(db: &Database, sender_type: &str, content: &str) {
        db.create_message(CreateMessageRequest {
            conversation_id: None,
            parent_id: None,
            sender_type: sender_type.to_string(),
            sender_id: None,
            content: content.to_string(),
            tokens: None,
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn seed_backfills_recent_distinct_user_messages() {
        let (db, _dir) = test_db().await;
        add_message(&db, "user", "older question").await;
        add_message(&db, "assistant", "model answer").await;
        add_message(&db, "user", "  newer question  ").await;
        add_message(&db, "user", "older question").await;
        add_message(&db, "user", "   ").await;
        rearm_seed(&db).await;

        db.ensure_prompt_history_seeded().await.unwrap();

        // Dedup keeps the LAST occurrence's recency: "older question" was
        // re-sent most recently, so it seeds as the newest entry
        assert_eq!(
            db.get_prompt_history().await.unwrap(),
            ["older question", "newer question"]
        );
    }

    #[tokio::test]
    async fn seed_never_reruns_after_first_pass() {
        let (db, _dir) = test_db().await;
        add_message(&db, "user", "hello").await;
        rearm_seed(&db).await;
        db.ensure_prompt_history_seeded().await.unwrap();

        // A later "clear history" must not be undone by the seed
        sqlx::query("DELETE FROM prompt_history")
            .execute(db.local_pool())
            .await
            .unwrap();
        db.ensure_prompt_history_seeded().await.unwrap();

        assert_eq!(db.get_prompt_history().await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn seed_respects_cap() {
        let (db, _dir) = test_db().await;
        for i in 0..(PROMPT_HISTORY_CAP + 20) {
            add_message(&db, "user", &format!("msg-{i}")).await;
        }
        rearm_seed(&db).await;

        db.ensure_prompt_history_seeded().await.unwrap();

        let history = db.get_prompt_history().await.unwrap();
        assert_eq!(history.len() as i64, PROMPT_HISTORY_CAP);
        assert_eq!(history.first().unwrap(), "msg-119");
        assert_eq!(history.last().unwrap(), "msg-20");
    }
}
