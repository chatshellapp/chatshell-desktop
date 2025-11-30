use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, OsRng},
};
use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use rand::RngCore;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

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

const ENCRYPTION_KEY_SETTING: &str = "app_encryption_key";

// Cache for the encryption key to avoid repeated database reads
static ENCRYPTION_KEY_CACHE: OnceLock<[u8; 32]> = OnceLock::new();

/// Initialize the encryption key from database or generate a new one
/// This should be called once during app startup
pub fn init_encryption_key(conn: &rusqlite::Connection) -> Result<()> {
    let key = get_or_create_encryption_key(conn)?;
    let _ = ENCRYPTION_KEY_CACHE.set(key);
    Ok(())
}

/// Get or create the encryption key from the database
fn get_or_create_encryption_key(conn: &rusqlite::Connection) -> Result<[u8; 32]> {
    // Try to read existing key from settings
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [ENCRYPTION_KEY_SETTING],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(key_b64) = existing {
        // Decode existing key
        let key_bytes = general_purpose::STANDARD
            .decode(&key_b64)
            .map_err(|e| anyhow::anyhow!("Failed to decode encryption key: {}", e))?;
        
        if key_bytes.len() != 32 {
            return Err(anyhow::anyhow!("Invalid encryption key length"));
        }
        
        let mut key = [0u8; 32];
        key.copy_from_slice(&key_bytes);
        println!("🔐 [crypto] Loaded encryption key from database");
        Ok(key)
    } else {
        // Generate new key
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        
        let key_b64 = general_purpose::STANDARD.encode(&key);
        let now = chrono::Utc::now().to_rfc3339();
        
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![ENCRYPTION_KEY_SETTING, key_b64, now],
        )?;
        
        println!("🔐 [crypto] Generated and stored new encryption key in database");
        Ok(key)
    }
}

/// Get the cached encryption key
fn get_encryption_key() -> Result<[u8; 32]> {
    ENCRYPTION_KEY_CACHE
        .get()
        .copied()
        .ok_or_else(|| anyhow::anyhow!("Encryption key not initialized. Call init_encryption_key first."))
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

    // Note: Tests that use encrypt/decrypt need the encryption key to be initialized
    // These tests are for the keypair functionality which doesn't depend on the DB key

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
