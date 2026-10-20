use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateProviderRequest, Provider};

impl Database {
    pub async fn create_provider(&self, req: CreateProviderRequest) -> Result<Provider> {
        // Built-in provider types are singletons by type with a
        // DETERMINISTIC id (UUID v5): every device adding "OpenAI" produces
        // the same row, so merges converge instead of duplicating the
        // provider — type-based singleton lookups in the UI then never
        // pick the wrong twin (real-device finding: two MiniMax CN rows
        // made model switching appear broken). An existing same-type row
        // is updated in place rather than duplicated.
        if chatshell_agent_core::is_builtin_provider_type(&req.provider_type) {
            if let Some(existing) = self
                .list_providers()
                .await?
                .into_iter()
                .find(|p| p.provider_type == req.provider_type)
            {
                tracing::info!(
                    "🔁 [db] Built-in provider {} already exists; updating in place",
                    req.provider_type
                );
                return self.update_provider(&existing.id, req).await;
            }
        }
        let id = if chatshell_agent_core::is_builtin_provider_type(&req.provider_type) {
            crate::db::system_ids::system_uuid(&format!("chatshell.provider.{}", req.provider_type))
        } else {
            Uuid::now_v7().to_string()
        };
        let now = Utc::now().to_rfc3339();
        let is_enabled = req.is_enabled.unwrap_or(true);

        // Handle API key based on keychain availability
        let encrypted_api_key = if let Some(ref api_key) = req.api_key {
            if !api_key.is_empty() {
                if crate::crypto::is_keychain_available() {
                    // Keychain available: encrypt and store in DB
                    match crate::crypto::encrypt(api_key) {
                        Ok(encrypted) => {
                            tracing::info!("🔐 [db] API key encrypted and stored in database");
                            Some(encrypted)
                        }
                        Err(e) => {
                            tracing::warn!("⚠️  [db] Failed to encrypt API key: {}", e);
                            None
                        }
                    }
                } else {
                    // Keychain unavailable: store in memory only, not in DB
                    crate::crypto::cache_api_key(&id, api_key);
                    tracing::info!("🔐 [db] API key cached in memory only (keychain unavailable)");
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        sqlx::query(
            "INSERT INTO providers (id, name, provider_type, api_key, base_url, api_style, description, is_enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.provider_type)
        .bind(&encrypted_api_key)
        .bind(&req.base_url)
        .bind(&req.api_style)
        .bind(&req.description)
        .bind(is_enabled as i32)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_provider(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created provider"))
    }

    pub async fn get_provider(&self, id: &str) -> Result<Option<Provider>> {
        let row = sqlx::query(
            "SELECT id, name, provider_type, api_key, base_url, api_style, description, is_enabled, created_at, updated_at
             FROM providers WHERE id = ? AND deleted_at IS NULL"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => {
                let provider_id: String = row.get("id");
                let encrypted_api_key: Option<String> = row.get("api_key");

                // Get API key: try DB first, then fall back to in-memory cache
                let api_key = encrypted_api_key
                    .and_then(|encrypted| match crate::crypto::decrypt(&encrypted) {
                        Ok(decrypted) => Some(decrypted),
                        Err(e) => {
                            tracing::error!(
                                "⚠️  [db] Failed to decrypt API key for provider {}: {}",
                                provider_id,
                                e
                            );
                            None
                        }
                    })
                    .or_else(|| crate::crypto::get_cached_api_key(&provider_id));

                let is_enabled: i32 = row.get("is_enabled");

                Ok(Some(Provider {
                    id: provider_id,
                    name: row.get("name"),
                    provider_type: row.get("provider_type"),
                    api_key,
                    base_url: row.get("base_url"),
                    api_style: row.get("api_style"),
                    description: row.get("description"),
                    is_enabled: is_enabled != 0,
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn list_providers(&self) -> Result<Vec<Provider>> {
        let rows = sqlx::query(
            "SELECT id, name, provider_type, api_key, base_url, api_style, description, is_enabled, created_at, updated_at
             FROM providers WHERE deleted_at IS NULL ORDER BY created_at ASC"
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut providers = Vec::new();
        for row in rows {
            let provider_id: String = row.get("id");
            let encrypted_api_key: Option<String> = row.get("api_key");

            // Get API key: try DB first, then fall back to in-memory cache
            let api_key = encrypted_api_key
                .and_then(|encrypted| match crate::crypto::decrypt(&encrypted) {
                    Ok(decrypted) => Some(decrypted),
                    Err(e) => {
                        tracing::error!(
                            "⚠️  [db] Failed to decrypt API key for provider {}: {}",
                            provider_id,
                            e
                        );
                        None
                    }
                })
                .or_else(|| crate::crypto::get_cached_api_key(&provider_id));

            let is_enabled: i32 = row.get("is_enabled");

            providers.push(Provider {
                id: provider_id,
                name: row.get("name"),
                provider_type: row.get("provider_type"),
                api_key,
                base_url: row.get("base_url"),
                api_style: row.get("api_style"),
                description: row.get("description"),
                is_enabled: is_enabled != 0,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            });
        }

        Ok(providers)
    }

    pub async fn update_provider(&self, id: &str, req: CreateProviderRequest) -> Result<Provider> {
        let now = Utc::now().to_rfc3339();
        let is_enabled = req.is_enabled.unwrap_or(true);

        // Handle API key based on keychain availability
        let encrypted_api_key = if let Some(ref api_key) = req.api_key {
            if !api_key.is_empty() {
                if crate::crypto::is_keychain_available() {
                    // Keychain available: encrypt and store in DB
                    // Also clear any cached key
                    crate::crypto::remove_cached_api_key(id);
                    match crate::crypto::encrypt(api_key) {
                        Ok(encrypted) => Some(encrypted),
                        Err(e) => {
                            tracing::warn!("⚠️  [db] Failed to encrypt API key: {}", e);
                            None
                        }
                    }
                } else {
                    // Keychain unavailable: store in memory only, not in DB
                    crate::crypto::cache_api_key(id, api_key);
                    tracing::info!("🔐 [db] API key cached in memory only (keychain unavailable)");
                    // Return early - don't update api_key column in DB
                    return self
                        .update_provider_without_api_key(id, &req, &now, is_enabled)
                        .await;
                }
            } else {
                // Empty API key means clear it
                crate::crypto::remove_cached_api_key(id);
                None
            }
        } else {
            // No API key in request - keep existing (don't update api_key column)
            return self
                .update_provider_without_api_key(id, &req, &now, is_enabled)
                .await;
        };

        sqlx::query(
            "UPDATE providers SET name = ?, provider_type = ?, api_key = ?, base_url = ?, api_style = ?, description = ?, is_enabled = ?, updated_at = ? WHERE id = ?"
        )
        .bind(&req.name)
        .bind(&req.provider_type)
        .bind(&encrypted_api_key)
        .bind(&req.base_url)
        .bind(&req.api_style)
        .bind(&req.description)
        .bind(is_enabled as i32)
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        self.get_provider(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Provider not found"))
    }

    async fn update_provider_without_api_key(
        &self,
        id: &str,
        req: &CreateProviderRequest,
        now: &str,
        is_enabled: bool,
    ) -> Result<Provider> {
        sqlx::query(
            "UPDATE providers SET name = ?, provider_type = ?, base_url = ?, api_style = ?, description = ?, is_enabled = ?, updated_at = ? WHERE id = ?"
        )
        .bind(&req.name)
        .bind(&req.provider_type)
        .bind(&req.base_url)
        .bind(&req.api_style)
        .bind(&req.description)
        .bind(is_enabled as i32)
        .bind(now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;

        self.get_provider(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Provider not found"))
    }

    pub async fn delete_provider(&self, id: &str) -> Result<()> {
        // Clear cached API key if any
        crate::crypto::remove_cached_api_key(id);

        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "providers",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
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

    /// A request for a non-builtin provider type: "custom" never triggers
    /// the type-singleton update-in-place path.
    fn custom_req(name: &str) -> CreateProviderRequest {
        CreateProviderRequest {
            name: name.to_string(),
            provider_type: "custom".to_string(),
            api_key: None,
            base_url: None,
            api_style: None,
            description: None,
            is_enabled: None,
        }
    }

    #[tokio::test]
    async fn create_provider_round_trips_all_fields() {
        let (db, _dir) = test_db().await;
        let req = CreateProviderRequest {
            name: "Acme LLM".to_string(),
            provider_type: "custom".to_string(),
            api_key: Some("sk-round-trip".to_string()),
            base_url: Some("https://acme.example/v1".to_string()),
            api_style: Some("chat_completions".to_string()),
            description: Some("Acme endpoint".to_string()),
            is_enabled: None,
        };
        let created = db.create_provider(req).await.unwrap();

        assert_eq!(created.name, "Acme LLM");
        assert_eq!(created.provider_type, "custom");
        // The key comes back as plaintext whether it was encrypted into the
        // api_key column (keychain available) or held in the in-memory cache.
        assert_eq!(created.api_key.as_deref(), Some("sk-round-trip"));
        assert_eq!(created.base_url.as_deref(), Some("https://acme.example/v1"));
        assert_eq!(created.api_style.as_deref(), Some("chat_completions"));
        assert_eq!(created.description.as_deref(), Some("Acme endpoint"));
        assert!(created.is_enabled, "is_enabled defaults to true");
        assert!(!created.created_at.is_empty());
        assert!(!created.updated_at.is_empty());

        let fetched = db.get_provider(&created.id).await.unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.provider_type, "custom");
        assert_eq!(fetched.api_key.as_deref(), Some("sk-round-trip"));
        assert_eq!(fetched.base_url.as_deref(), Some("https://acme.example/v1"));
        assert_eq!(fetched.api_style.as_deref(), Some("chat_completions"));
        assert_eq!(fetched.description.as_deref(), Some("Acme endpoint"));
        assert!(fetched.is_enabled);
    }

    #[tokio::test]
    async fn create_provider_honors_disabled_flag() {
        let (db, _dir) = test_db().await;
        let mut req = custom_req("Disabled Co");
        req.is_enabled = Some(false);
        let created = db.create_provider(req).await.unwrap();
        assert!(!created.is_enabled);
    }

    #[tokio::test]
    async fn get_provider_missing_returns_none() {
        let (db, _dir) = test_db().await;
        assert!(db.get_provider("no-such-id").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_providers_orders_by_creation_asc() {
        let (db, _dir) = test_db().await;
        for name in ["first", "second", "third"] {
            db.create_provider(custom_req(name)).await.unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        let names: Vec<String> = db
            .list_providers()
            .await
            .unwrap()
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(names, vec!["first", "second", "third"]);
    }

    #[tokio::test]
    async fn update_provider_rotates_fields_and_api_key() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_provider(CreateProviderRequest {
                api_key: Some("sk-original".to_string()),
                ..custom_req("Old Name")
            })
            .await
            .unwrap();

        let updated = db
            .update_provider(
                &created.id,
                CreateProviderRequest {
                    name: "New Name".to_string(),
                    provider_type: "custom".to_string(),
                    api_key: Some("sk-rotated".to_string()),
                    base_url: Some("https://new.example/v1".to_string()),
                    api_style: Some("responses".to_string()),
                    description: Some("Rewired".to_string()),
                    is_enabled: Some(false),
                },
            )
            .await
            .unwrap();

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "New Name");
        assert_eq!(updated.api_key.as_deref(), Some("sk-rotated"));
        assert_eq!(updated.base_url.as_deref(), Some("https://new.example/v1"));
        assert_eq!(updated.api_style.as_deref(), Some("responses"));
        assert_eq!(updated.description.as_deref(), Some("Rewired"));
        assert!(!updated.is_enabled);

        let fetched = db.get_provider(&created.id).await.unwrap().unwrap();
        assert_eq!(fetched.api_key.as_deref(), Some("sk-rotated"));
        assert_eq!(fetched.name, "New Name");
        assert!(!fetched.is_enabled);
    }

    #[tokio::test]
    async fn update_provider_keeps_api_key_when_request_has_none() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_provider(CreateProviderRequest {
                api_key: Some("sk-keep".to_string()),
                ..custom_req("Keeper")
            })
            .await
            .unwrap();

        let updated = db
            .update_provider(&created.id, custom_req("Keeper Renamed"))
            .await
            .unwrap();

        assert_eq!(updated.name, "Keeper Renamed");
        assert_eq!(
            updated.api_key.as_deref(),
            Some("sk-keep"),
            "absent api_key must not clobber the stored key"
        );
    }

    #[tokio::test]
    async fn update_provider_clears_api_key_on_empty_string() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_provider(CreateProviderRequest {
                api_key: Some("sk-to-clear".to_string()),
                ..custom_req("Clearable")
            })
            .await
            .unwrap();

        let mut req = custom_req("Clearable");
        req.api_key = Some(String::new());
        let updated = db.update_provider(&created.id, req).await.unwrap();

        assert_eq!(updated.api_key, None, "empty api_key clears the key");
    }

    #[tokio::test]
    async fn update_provider_missing_id_is_error() {
        let (db, _dir) = test_db().await;
        assert!(
            db.update_provider("no-such-id", custom_req("Ghost"))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn delete_provider_tombstones_row_and_wipes_payload() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_provider(CreateProviderRequest {
                api_key: Some("sk-doomed".to_string()),
                ..custom_req("Doomed")
            })
            .await
            .unwrap();

        db.delete_provider(&created.id).await.unwrap();

        // Soft delete: the row stays (tombstoned) with its payload wiped.
        let (deleted_at, api_key, provider_type, is_enabled): (
            Option<String>,
            Option<String>,
            String,
            Option<i32>,
        ) = sqlx::query_as(
            "SELECT deleted_at, api_key, provider_type, is_enabled FROM providers WHERE id = ?",
        )
        .bind(&created.id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert!(deleted_at.is_some(), "row must be tombstoned, not removed");
        assert_eq!(api_key, None);
        assert_eq!(provider_type, "");
        assert_eq!(is_enabled, None);

        // Deleted providers disappear from every read path.
        assert!(db.get_provider(&created.id).await.unwrap().is_none());
        assert!(
            !db.list_providers()
                .await
                .unwrap()
                .iter()
                .any(|p| p.id == created.id)
        );

        // Second delete is a no-op that still succeeds (guard: deleted_at IS NULL).
        db.delete_provider(&created.id).await.unwrap();
    }

    #[tokio::test]
    async fn builtin_provider_type_is_singleton_updated_in_place() {
        let (db, _dir) = test_db().await;
        let first = db
            .create_provider(CreateProviderRequest {
                name: "OpenAI One".to_string(),
                provider_type: "openai".to_string(),
                api_key: None,
                base_url: None,
                api_style: None,
                description: None,
                is_enabled: None,
            })
            .await
            .unwrap();
        let second = db
            .create_provider(CreateProviderRequest {
                name: "OpenAI Two".to_string(),
                provider_type: "openai".to_string(),
                api_key: None,
                base_url: None,
                api_style: None,
                description: None,
                is_enabled: None,
            })
            .await
            .unwrap();

        assert_eq!(
            second.id, first.id,
            "builtin type re-create must update in place, not duplicate"
        );
        let openai_rows: Vec<Provider> = db
            .list_providers()
            .await
            .unwrap()
            .into_iter()
            .filter(|p| p.provider_type == "openai")
            .collect();
        assert_eq!(openai_rows.len(), 1);
        assert_eq!(openai_rows[0].name, "OpenAI Two");
    }
}
