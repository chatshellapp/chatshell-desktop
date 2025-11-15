use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use anyhow::Result;
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};

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

/// Get or create a machine-specific encryption key
/// In a production app, you'd want to use the system keychain
/// For now, we'll use a deterministic key derived from machine info
fn get_encryption_key() -> Result<[u8; 32]> {
    // In production, use system keychain or secure storage
    // For now, use a fixed key (NOT SECURE FOR PRODUCTION)
    // TODO: Integrate with macOS Keychain, Windows Credential Manager, Linux Secret Service
    let key_material = b"chatshell_encryption_key_v1_____"; // 32 bytes
    Ok(*key_material)
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
    fn test_encrypt_decrypt() {
        let plaintext = "my-secret-api-key";
        let encrypted = encrypt(plaintext).unwrap();
        let decrypted = decrypt(&encrypted).unwrap();
        assert_eq!(plaintext, decrypted);
    }

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

