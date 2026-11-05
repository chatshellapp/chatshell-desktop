use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateTranslationHistoryRequest, TranslationHistoryEntry};

/// Maximum entries kept in the translation history; oldest evicted on insert.
pub const TRANSLATION_HISTORY_CAP: i64 = 200;

const SELECT_COLUMNS: &str = "id, source_text, translated_text, source_language, \
     target_language, model_id, created_at";

impl Database {
    /// Record a completed translation. Translating the same text between the
    /// same languages again replaces the result and moves it to the front.
    /// Returns `None` when the source or result is blank.
    pub async fn add_translation_history_entry(
        &self,
        req: CreateTranslationHistoryRequest,
    ) -> Result<Option<TranslationHistoryEntry>> {
        let source_text = req.source_text.trim();
        let translated_text = req.translated_text.trim();
        if source_text.is_empty() || translated_text.is_empty() {
            return Ok(None);
        }

        let now = Utc::now().to_rfc3339();
        let mut tx = self.local_pool.begin().await?;

        let entry: TranslationHistoryEntry = sqlx::query_as(&format!(
            "INSERT INTO translation_history
                (id, source_text, translated_text, source_language, target_language, model_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source_text, source_language, target_language) DO UPDATE SET
                translated_text = excluded.translated_text,
                model_id = excluded.model_id,
                created_at = excluded.created_at
             RETURNING {SELECT_COLUMNS}"
        ))
        .bind(Uuid::now_v7().to_string())
        .bind(source_text)
        .bind(translated_text)
        .bind(&req.source_language)
        .bind(&req.target_language)
        .bind(&req.model_id)
        .bind(&now)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "DELETE FROM translation_history WHERE id NOT IN (
                SELECT id FROM translation_history
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?
            )",
        )
        .bind(TRANSLATION_HISTORY_CAP)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(Some(entry))
    }

    /// Newest-first entries (already capped by inserts). Filtering happens in
    /// the UI, where case folding handles non-ASCII text correctly.
    pub async fn list_translation_history(&self) -> Result<Vec<TranslationHistoryEntry>> {
        let entries = sqlx::query_as(&format!(
            "SELECT {SELECT_COLUMNS} FROM translation_history ORDER BY created_at DESC, id DESC"
        ))
        .fetch_all(self.local_pool.as_ref())
        .await?;
        Ok(entries)
    }

    pub async fn delete_translation_history_entry(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM translation_history WHERE id = ?")
            .bind(id)
            .execute(self.local_pool.as_ref())
            .await?;
        Ok(())
    }

    pub async fn clear_translation_history(&self) -> Result<()> {
        sqlx::query("DELETE FROM translation_history")
            .execute(self.local_pool.as_ref())
            .await?;
        Ok(())
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

    fn req(source: &str, translated: &str, target: &str) -> CreateTranslationHistoryRequest {
        CreateTranslationHistoryRequest {
            source_text: source.to_string(),
            translated_text: translated.to_string(),
            source_language: "auto".to_string(),
            target_language: target.to_string(),
            model_id: Some("model-1".to_string()),
        }
    }

    fn sources(entries: &[TranslationHistoryEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.source_text.as_str()).collect()
    }

    #[tokio::test]
    async fn add_returns_entry_and_lists_newest_first() {
        let (db, _dir) = test_db().await;
        let first = db
            .add_translation_history_entry(req("hello", "bonjour", "fr"))
            .await
            .unwrap()
            .unwrap();
        db.add_translation_history_entry(req("goodbye", "au revoir", "fr"))
            .await
            .unwrap();

        assert_eq!(first.translated_text, "bonjour");
        assert_eq!(Uuid::parse_str(&first.id).unwrap().get_version_num(), 7);
        let entries = db.list_translation_history().await.unwrap();
        assert_eq!(sources(&entries), ["goodbye", "hello"]);
    }

    #[tokio::test]
    async fn same_text_and_languages_replaces_and_moves_to_front() {
        let (db, _dir) = test_db().await;
        let original = db
            .add_translation_history_entry(req("hello", "bonjour", "fr"))
            .await
            .unwrap()
            .unwrap();
        db.add_translation_history_entry(req("other", "autre", "fr"))
            .await
            .unwrap();
        let updated = db
            .add_translation_history_entry(req("hello", "salut", "fr"))
            .await
            .unwrap()
            .unwrap();

        assert_eq!(updated.id, original.id);
        let entries = db.list_translation_history().await.unwrap();
        assert_eq!(sources(&entries), ["hello", "other"]);
        assert_eq!(entries[0].translated_text, "salut");
    }

    #[tokio::test]
    async fn different_target_is_a_separate_entry() {
        let (db, _dir) = test_db().await;
        db.add_translation_history_entry(req("hello", "bonjour", "fr"))
            .await
            .unwrap();
        db.add_translation_history_entry(req("hello", "hola", "es"))
            .await
            .unwrap();

        assert_eq!(db.list_translation_history().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn blank_source_or_result_is_ignored() {
        let (db, _dir) = test_db().await;
        assert!(
            db.add_translation_history_entry(req("   ", "x", "fr"))
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            db.add_translation_history_entry(req("x", "  ", "fr"))
                .await
                .unwrap()
                .is_none()
        );

        assert!(db.list_translation_history().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn cap_evicts_oldest() {
        let (db, _dir) = test_db().await;
        for i in 0..(TRANSLATION_HISTORY_CAP + 5) {
            db.add_translation_history_entry(req(&format!("entry-{i}"), "t", "fr"))
                .await
                .unwrap();
        }

        let entries = db.list_translation_history().await.unwrap();
        assert_eq!(entries.len() as i64, TRANSLATION_HISTORY_CAP);
        assert_eq!(entries.first().unwrap().source_text, "entry-204");
        assert_eq!(entries.last().unwrap().source_text, "entry-5");
    }

    /// The sync snapshot is a whole-file copy of the canonical database, so
    /// history must live only in the device-local file.
    #[tokio::test]
    async fn history_lives_outside_the_canonical_database() {
        let (db, dir) = test_db().await;
        db.add_translation_history_entry(req("secret", "secreto", "es"))
            .await
            .unwrap();

        let canonical: Option<(String,)> =
            sqlx::query_as("SELECT name FROM sqlite_master WHERE name = 'translation_history'")
                .fetch_optional(db.pool())
                .await
                .unwrap();
        assert!(canonical.is_none());
        assert!(dir.path().join("t.local.db").exists());
        assert_eq!(db.list_translation_history().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn delete_and_clear() {
        let (db, _dir) = test_db().await;
        let a = db
            .add_translation_history_entry(req("a", "x", "fr"))
            .await
            .unwrap()
            .unwrap();
        db.add_translation_history_entry(req("b", "y", "fr"))
            .await
            .unwrap();

        db.delete_translation_history_entry(&a.id).await.unwrap();
        let entries = db.list_translation_history().await.unwrap();
        assert_eq!(sources(&entries), ["b"]);

        db.clear_translation_history().await.unwrap();
        assert!(db.list_translation_history().await.unwrap().is_empty());
    }
}
