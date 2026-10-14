use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

use super::Database;

/// Maximum entries kept in the input history; oldest evicted on insert.
const PROMPT_HISTORY_CAP: i64 = 100;

impl Database {
    /// One-time upgrade seed: when the global history has never been
    /// populated, backfill it from the most recent distinct user messages
    /// (same cap and newest-first order as live recording). A `meta` flag
    /// keeps the seed from re-running after the user clears the history.
    pub async fn ensure_prompt_history_seeded(&self) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        let seeded: Option<(String,)> =
            sqlx::query_as("SELECT value FROM meta WHERE key = 'prompt_history_seeded'")
                .fetch_optional(&mut *tx)
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
        .fetch_all(&mut *tx)
        .await?;

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

        sqlx::query("INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES ('prompt_history_seeded', '1', ?)")
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
        let mut tx = self.pool.begin().await?;

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
                .fetch_all(self.pool.as_ref())
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

    async fn rearm_seed(db: &Database) {
        sqlx::query("DELETE FROM meta WHERE key = 'prompt_history_seeded'")
            .execute(db.pool())
            .await
            .unwrap();
    }

    async fn add_message(db: &Database, sender_type: &str, content: &str) {
        db.create_message(CreateMessageRequest {
            conversation_id: None,
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
            .execute(db.pool())
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
