//! One-shot ciphertext repair after a master-key adoption.
//!
//! When the iCloud-synchronizable item replaces a different local master
//! key (first contact with a peer-minted key), rows this device encrypted
//! earlier still carry ciphertext under the demoted key. Reads keep
//! working through the previous-key fallback in `crypto::decrypt`, but
//! peers cannot open those rows — so this pass re-encrypts every
//! ciphertext column under the adopted key and bumps `updated_at`, letting
//! the repair converge to peers through the ordinary LWW merge. On success
//! the previous-key slot is cleared; a failure keeps it armed for the next
//! launch.

use anyhow::Result;

impl crate::db::Database {
    /// Re-encrypt `providers.api_key` and `tools.auth_token` rows that only
    /// open under the previous key. Returns how many rows were rewritten.
    /// Fast no-op when no previous key is held.
    pub async fn repair_master_key_ciphertext(&self) -> Result<usize> {
        if !crate::crypto::has_previous_key() {
            return Ok(0);
        }
        let now = chrono::Utc::now().to_rfc3339();
        let mut repaired = 0usize;

        let providers: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, api_key FROM providers \
             WHERE api_key IS NOT NULL AND api_key != '' AND deleted_at IS NULL",
        )
        .fetch_all(self.pool())
        .await?;

        for (id, ciphertext) in providers {
            if crate::crypto::decrypt_current_only(&ciphertext).is_ok() {
                continue; // already under the adopted key
            }
            let Some(plaintext) = crate::crypto::decrypt(&ciphertext).ok() else {
                // Neither local key opens it (encrypted by a peer's key this
                // device never held); leave the row for LWW to settle.
                tracing::debug!("provider {id} ciphertext not openable locally; skipped");
                continue;
            };
            let resealed = crate::crypto::encrypt(&plaintext)?;
            sqlx::query("UPDATE providers SET api_key = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(&resealed)
                .bind(&now)
                .bind(&id)
                .execute(self.pool())
                .await?;
            repaired += 1;
        }

        // MCP tool bearer/OAuth tokens ride the same `tools` table through
        // snapshot sync and the same master key (`commands/mcp.rs`).
        let tools: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, auth_token FROM tools \
             WHERE auth_token IS NOT NULL AND auth_token != '' AND deleted_at IS NULL",
        )
        .fetch_all(self.pool())
        .await?;

        for (id, ciphertext) in tools {
            if crate::crypto::decrypt_current_only(&ciphertext).is_ok() {
                continue;
            }
            let Some(plaintext) = crate::crypto::decrypt(&ciphertext).ok() else {
                tracing::debug!("tool {id} ciphertext not openable locally; skipped");
                continue;
            };
            let resealed = crate::crypto::encrypt(&plaintext)?;
            sqlx::query("UPDATE tools SET auth_token = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(&resealed)
                .bind(&now)
                .bind(&id)
                .execute(self.pool())
                .await?;
            repaired += 1;
        }

        if repaired > 0 {
            tracing::info!(
                "🔐 [key-repair] Re-encrypted {repaired} row(s) under the adopted master key"
            );
        }
        crate::crypto::clear_previous_key();
        Ok(repaired)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    async fn fresh_db() -> Database {
        let dir =
            std::env::temp_dir().join(format!("chatshell-keyrepair-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        Database::new(dir.join("t.sqlite").to_str().unwrap())
            .await
            .unwrap()
    }

    async fn seed_provider(pool: &sqlx::sqlite::SqlitePool, id: &str, api_key: &str) {
        sqlx::query(
            "INSERT INTO providers (id, name, provider_type, is_enabled, created_at, updated_at) \
             VALUES (?1, ?2, 'openai', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(format!("p-{id}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("UPDATE providers SET api_key = ?1 WHERE id = ?2")
            .bind(api_key)
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn reencrypts_rows_under_previous_key_and_clears_slot() {
        let db = fresh_db().await;
        let old_key = chatshell_agent_core::crypto::generate_master_key();
        let new_key = chatshell_agent_core::crypto::generate_master_key();
        let sealed_old =
            chatshell_agent_core::crypto::encrypt(&old_key, "sk-old-generation").unwrap();
        let sealed_new = chatshell_agent_core::crypto::encrypt(&new_key, "sk-current").unwrap();
        seed_provider(db.pool(), "p1", &sealed_old).await;
        seed_provider(db.pool(), "p2", &sealed_new).await;

        crate::crypto::set_keys_for_tests(new_key, Some(old_key));
        let repaired = db.repair_master_key_ciphertext().await.unwrap();

        assert_eq!(repaired, 1, "only the previous-key row is rewritten");
        assert!(!crate::crypto::has_previous_key(), "slot cleared");
        let p1: String = sqlx::query_scalar("SELECT api_key FROM providers WHERE id = 'p1'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(
            crate::crypto::decrypt_current_only(&p1).unwrap(),
            "sk-old-generation"
        );
        let p2: String = sqlx::query_scalar("SELECT api_key FROM providers WHERE id = 'p2'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(p2, sealed_new, "current-key row untouched");
    }

    #[tokio::test]
    async fn no_previous_key_is_a_fast_noop() {
        let db = fresh_db().await;
        let foreign = chatshell_agent_core::crypto::generate_master_key();
        let sealed_foreign =
            chatshell_agent_core::crypto::encrypt(&foreign, "sk-from-peer").unwrap();
        seed_provider(db.pool(), "p1", &sealed_foreign).await;

        let mine = chatshell_agent_core::crypto::generate_master_key();
        crate::crypto::set_keys_for_tests(mine, None);
        let repaired = db.repair_master_key_ciphertext().await.unwrap();
        assert_eq!(repaired, 0);
        let p1: String = sqlx::query_scalar("SELECT api_key FROM providers WHERE id = 'p1'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(p1, sealed_foreign, "unknown-key ciphertext preserved");
    }

    #[tokio::test]
    async fn decrypt_falls_back_to_previous_key() {
        let old_key = chatshell_agent_core::crypto::generate_master_key();
        let new_key = chatshell_agent_core::crypto::generate_master_key();
        let sealed_old = chatshell_agent_core::crypto::encrypt(&old_key, "sk-fallback").unwrap();
        crate::crypto::set_keys_for_tests(new_key, Some(old_key));
        assert_eq!(crate::crypto::decrypt(&sealed_old).unwrap(), "sk-fallback");
    }
}
