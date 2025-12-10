use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use anyhow::Result;
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use crate::keychain;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedKeyPair {
    pub public_key: String,
    pub private_key: String,
}

/// Generate a new keypair for sync functionality
pub fn generate_keypair() -> Result<GeneratedKeyPair> {
    let mut public_key = vec![0u8; 32];
    let mut private_key = vec![0u8; 32];

    OsRng.fill_bytes(&mut public_key);
    OsRng.fill_bytes(&mut private_key);

    Ok(GeneratedKeyPair {
        public_key: general_purpose::STANDARD.encode(&public_key),
        private_key: general_purpose::STANDARD.encode(&private_key),
    })
}

/// Export keypair to JSON string
pub fn export_keypair(public_key: &str, private_key: &str) -> Result<String> {
    let keypair = GeneratedKeyPair {
        public_key: public_key.to_string(),
        private_key: private_key.to_string(),
    };
    Ok(serde_json::to_string(&keypair)?)
}

/// Import keypair from JSON string
pub fn import_keypair(json: &str) -> Result<GeneratedKeyPair> {
    Ok(serde_json::from_str(json)?)
}

const MASTER_KEY_NAME: &str = "master_encryption_key";

// Cache for the encryption key to avoid repeated keychain reads
static ENCRYPTION_KEY_CACHE: OnceLock<[u8; 32]> = OnceLock::new();

// Track whether keychain is available for secure storage
static KEYCHAIN_AVAILABLE: OnceLock<bool> = OnceLock::new();

// In-memory cache for API keys when keychain is unavailable
// Key: provider_id, Value: plaintext API key
static EPHEMERAL_API_KEY_CACHE: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();

/// Initialize the encryption key from OS keychain or generate a new one
/// This should be called once during app startup
/// 
/// If keychain access is denied, falls back to an ephemeral in-memory key.
/// In this case, API keys will need to be re-entered after app restart.
pub fn init_encryption_key() {
    match get_or_create_encryption_key() {
        Ok(key) => {
            let _ = ENCRYPTION_KEY_CACHE.set(key);
            let _ = KEYCHAIN_AVAILABLE.set(true);
        }
        Err(e) => {
            tracing::warn!(
                "⚠️ [crypto] Keychain unavailable, API keys will not be persisted securely: {}",
                e
            );
            // Generate a temporary in-memory key
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            let _ = ENCRYPTION_KEY_CACHE.set(key);
            let _ = KEYCHAIN_AVAILABLE.set(false);
        }
    }
}

/// Check if keychain is available for secure storage
///
/// Returns false if:
/// - User denied keychain access
/// - No keychain service available (e.g., headless Linux without Secret Service)
/// - Keychain initialization hasn't been called yet
pub fn is_keychain_available() -> bool {
    KEYCHAIN_AVAILABLE.get().copied().unwrap_or(false)
}

/// Get the ephemeral API key cache
fn get_api_key_cache() -> &'static RwLock<HashMap<String, String>> {
    EPHEMERAL_API_KEY_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Store an API key in the ephemeral in-memory cache
/// Used when keychain is unavailable
pub fn cache_api_key(provider_id: &str, api_key: &str) {
    if let Ok(mut cache) = get_api_key_cache().write() {
        cache.insert(provider_id.to_string(), api_key.to_string());
        tracing::info!(
            "🔐 [crypto] Cached API key in memory for provider: {}",
            provider_id
        );
    }
}

/// Get an API key from the ephemeral in-memory cache
pub fn get_cached_api_key(provider_id: &str) -> Option<String> {
    get_api_key_cache()
        .read()
        .ok()
        .and_then(|cache| cache.get(provider_id).cloned())
}

/// Remove an API key from the ephemeral in-memory cache
pub fn remove_cached_api_key(provider_id: &str) {
    if let Ok(mut cache) = get_api_key_cache().write() {
        cache.remove(provider_id);
    }
}

/// Get or create the encryption key from the OS keychain
fn get_or_create_encryption_key() -> Result<[u8; 32]> {
    // Try to read existing key from OS keychain
    if let Some(key_b64) = keychain::get_secret(MASTER_KEY_NAME)? {
        // Decode existing key
        let key_bytes = general_purpose::STANDARD
            .decode(&key_b64)
            .map_err(|e| anyhow::anyhow!("Failed to decode encryption key: {}", e))?;

        if key_bytes.len() != 32 {
            return Err(anyhow::anyhow!("Invalid encryption key length"));
        }

        let mut key = [0u8; 32];
        key.copy_from_slice(&key_bytes);
        tracing::info!("🔐 [crypto] Loaded encryption key from OS keychain");
        Ok(key)
    } else {
        // Generate new key
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);

        let key_b64 = general_purpose::STANDARD.encode(&key);
        keychain::set_secret(MASTER_KEY_NAME, &key_b64)?;

        tracing::info!("🔐 [crypto] Generated and stored new encryption key in OS keychain");
        Ok(key)
    }
}

/// Get the cached encryption key
fn get_encryption_key() -> Result<[u8; 32]> {
    ENCRYPTION_KEY_CACHE.get().copied().ok_or_else(|| {
        anyhow::anyhow!("Encryption key not initialized. Call init_encryption_key first.")
    })
}

/// Encrypt API key or sensitive data
pub fn encrypt(plaintext: &str) -> Result<String> {
    let key = get_encryption_key()?;
    let cipher = Aes256Gcm::new(&key.into());

    // Generate a random nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt the plaintext
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext and encode as base64
    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&ciphertext);

    Ok(general_purpose::STANDARD.encode(&result))
}

/// Decrypt API key or sensitive data
pub fn decrypt(encrypted: &str) -> Result<String> {
    let key = get_encryption_key()?;
    let cipher = Aes256Gcm::new(&key.into());

    // Decode from base64
    let data = general_purpose::STANDARD
        .decode(encrypted)
        .map_err(|e| anyhow::anyhow!("Base64 decode failed: {}", e))?;

    if data.len() < 12 {
        return Err(anyhow::anyhow!("Invalid encrypted data"));
    }

    // Extract nonce and ciphertext
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    // Decrypt
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

    Ok(String::from_utf8(plaintext)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keypair_generation() {
        let keypair = generate_keypair().unwrap();
        assert!(!keypair.public_key.is_empty());
        assert!(!keypair.private_key.is_empty());
    }

    #[test]
    fn test_keypair_export_import() {
        let keypair = generate_keypair().unwrap();
        let json = export_keypair(&keypair.public_key, &keypair.private_key).unwrap();
        let imported = import_keypair(&json).unwrap();
        assert_eq!(keypair.public_key, imported.public_key);
        assert_eq!(keypair.private_key, imported.private_key);
    }
}
