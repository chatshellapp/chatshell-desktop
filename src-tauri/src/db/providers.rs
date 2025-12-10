use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateProviderRequest, Provider};

impl Database {
    pub async fn create_provider(&self, req: CreateProviderRequest) -> Result<Provider> {
        let id = Uuid::now_v7().to_string();
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
            "INSERT INTO providers (id, name, provider_type, api_key, base_url, description, is_enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&req.provider_type)
        .bind(&encrypted_api_key)
        .bind(&req.base_url)
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
            "SELECT id, name, provider_type, api_key, base_url, description, is_enabled, created_at, updated_at
             FROM providers WHERE id = ?"
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
            "SELECT id, name, provider_type, api_key, base_url, description, is_enabled, created_at, updated_at
             FROM providers ORDER BY created_at ASC"
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
            "UPDATE providers SET name = ?, provider_type = ?, api_key = ?, base_url = ?, description = ?, is_enabled = ?, updated_at = ? WHERE id = ?"
        )
        .bind(&req.name)
        .bind(&req.provider_type)
        .bind(&encrypted_api_key)
        .bind(&req.base_url)
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
            "UPDATE providers SET name = ?, provider_type = ?, base_url = ?, description = ?, is_enabled = ?, updated_at = ? WHERE id = ?"
        )
        .bind(&req.name)
        .bind(&req.provider_type)
        .bind(&req.base_url)
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

        sqlx::query("DELETE FROM providers WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }
}
