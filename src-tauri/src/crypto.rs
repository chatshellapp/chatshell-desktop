use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, OnceLock};

use crate::keychain;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedKeyPair {
    pub public_key: String,
    pub private_key: String,
}

/// Generate a new keypair for sync functionality
pub fn generate_keypair() -> Result<GeneratedKeyPair> {
    let public_key = chatshell_agent_core::crypto::generate_master_key();
    let private_key = chatshell_agent_core::crypto::generate_master_key();

    Ok(GeneratedKeyPair {
        public_key: general_purpose::STANDARD.encode(public_key),
        private_key: general_purpose::STANDARD.encode(private_key),
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
/// Device-local slot holding the key this device used before the last
/// adoption, kept only until the repair pass re-encrypts every ciphertext
/// row under the adopted key.
const PREVIOUS_MASTER_KEY_NAME: &str = "master_encryption_key_previous";

// Runtime key state. parking_lot RwLock (adoption can REPLACE the key
// after the initial load; tests reset both slots between scenarios) behind
// LazyLock (initializer known at declaration).
static ENCRYPTION_KEY_CACHE: LazyLock<parking_lot::RwLock<Option<[u8; 32]>>> =
    LazyLock::new(|| parking_lot::RwLock::new(None));
static PREVIOUS_KEY_CACHE: LazyLock<parking_lot::RwLock<Option<[u8; 32]>>> =
    LazyLock::new(|| parking_lot::RwLock::new(None));

/// Whether this launch MUST (re)publish the resolved key into the
/// synchronizable transport item: true after a Mint (fresh ecosystem key)
/// or a KeepCurrent with the transport item absent (retry the mint-time
/// write that may have failed). False after an adoption (the item already
/// carries the value) or a KeepCurrent with the item present — writing in
/// those states would clobber the ecosystem key with the local one
/// whenever the item read transiently fails.
static PUBLISH_MASTER_KEY: OnceLock<bool> = OnceLock::new();

/// In-memory cache for API keys when keychain is unavailable
/// Key: provider_id, Value: plaintext API key
static EPHEMERAL_API_KEY_CACHE: LazyLock<parking_lot::RwLock<HashMap<String, String>>> =
    LazyLock::new(|| parking_lot::RwLock::new(HashMap::new()));

/// Track whether keychain is available for secure storage
static KEYCHAIN_AVAILABLE: OnceLock<bool> = OnceLock::new();

/// Initialize the encryption key at app startup.
///
/// Resolution order (policy shared with iOS via `chatshell-agent-core`):
/// the iCloud-synchronizable item is the ecosystem authority — any device
/// that can read it adopts it (healing fresh installs and reinstalls);
/// otherwise the device-local key stands; otherwise one is minted. When
/// the item replaces a different local key, the old key is demoted to
/// [`PREVIOUS_MASTER_KEY_NAME`] so previously encrypted rows still open
/// until the repair pass re-encrypts them.
///
/// If keychain access is denied entirely, falls back to an ephemeral
/// in-memory key; API keys will need to be re-entered after app restart.
pub fn init_encryption_key() {
    match init_encryption_key_inner() {
        Ok(()) => {
            let _ = KEYCHAIN_AVAILABLE.set(true);
        }
        Err(e) => {
            tracing::warn!(
                "⚠️ [crypto] Keychain unavailable, API keys will not be persisted securely: {}",
                e
            );
            // Generate a temporary in-memory key
            let key = chatshell_agent_core::crypto::generate_master_key();
            *ENCRYPTION_KEY_CACHE.write() = Some(key);
            *PREVIOUS_KEY_CACHE.write() = None;
            let _ = KEYCHAIN_AVAILABLE.set(false);
        }
    }
}

fn init_encryption_key_inner() -> Result<()> {
    let sync_item = read_synchronizable_item();
    let local = keychain::get_secret(MASTER_KEY_NAME)?;

    use chatshell_agent_core::crypto::MasterKeyResolution as R;
    match chatshell_agent_core::crypto::resolve_master_key(sync_item.as_deref(), local.as_deref()) {
        R::KeepCurrent => {
            // Local stands. When the transport item is missing (dev
            // blocker, offline), keep republishing it at startup so the
            // ecosystem converges on this key; when the item is present
            // and equal, a write-back is a pure no-op — skip it so a
            // transiently failing read can never clobber the item.
            let publish = sync_item.is_none();
            let _ = PUBLISH_MASTER_KEY.set(publish);
            let key = decode_key(local.as_deref())?;
            *ENCRYPTION_KEY_CACHE.write() = Some(key);
        }
        R::AdoptSync { demote_current } => {
            let adopted = decode_key(sync_item.as_deref())?;
            if demote_current && let Some(old) = local {
                tracing::info!(
                    "🔐 [crypto] Adopting ecosystem master key from iCloud Keychain; \
                     previous local key kept as decrypt fallback"
                );
                keychain::set_secret(PREVIOUS_MASTER_KEY_NAME, &old)?;
            } else {
                tracing::info!("🔐 [crypto] Adopting ecosystem master key from iCloud Keychain");
            }
            keychain::set_secret(MASTER_KEY_NAME, sync_item.as_deref().unwrap_or_default())?;
            *ENCRYPTION_KEY_CACHE.write() = Some(adopted);
            // The transport item already carries the adopted value; a
            // write-back adds nothing and races concurrent peer changes.
            let _ = PUBLISH_MASTER_KEY.set(false);
        }
        R::Mint => {
            let key = chatshell_agent_core::crypto::generate_master_key();
            let key_b64 = general_ppurpose_encode(&key);
            keychain::set_secret(MASTER_KEY_NAME, &key_b64)?;
            *ENCRYPTION_KEY_CACHE.write() = Some(key);
            let _ = PUBLISH_MASTER_KEY.set(true);
            tracing::info!("🔐 [crypto] Minted new master encryption key");
        }
    }

    // A previous key may survive from an earlier launch whose repair pass
    // did not complete; load it for decrypt fallback so repair can retry.
    if let Some(prev) = keychain::get_secret(PREVIOUS_MASTER_KEY_NAME)? {
        *PREVIOUS_KEY_CACHE.write() = Some(decode_key(Some(&prev))?);
    }
    Ok(())
}

fn decode_key(b64: Option<&str>) -> Result<[u8; 32]> {
    let b64 = b64.ok_or_else(|| anyhow::anyhow!("master key absent"))?;
    let bytes = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| anyhow::anyhow!("Failed to decode encryption key: {}", e))?;
    if bytes.len() != 32 {
        return Err(anyhow::anyhow!("Invalid encryption key length"));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn general_ppurpose_encode(key: &[u8; 32]) -> String {
    general_purpose::STANDARD.encode(key)
}

/// The synchronizable item value, or None when it is absent or unreadable
/// (macOS dev builds without the keychain-access-groups entitlement, no
/// iCloud Keychain, offline first run).
#[cfg(target_os = "macos")]
fn read_synchronizable_item() -> Option<String> {
    match crate::sync_keychain::get_synchronizable_master_key() {
        Ok(value) => value,
        Err(err) => {
            tracing::debug!("🔐 [crypto] sync keychain item unreadable: {err:#}");
            None
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn read_synchronizable_item() -> Option<String> {
    None
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

/// Store an API key in the ephemeral in-memory cache
/// Used when keychain is unavailable
pub fn cache_api_key(provider_id: &str, api_key: &str) {
    EPHEMERAL_API_KEY_CACHE
        .write()
        .insert(provider_id.to_string(), api_key.to_string());
    tracing::info!(
        "🔐 [crypto] Cached API key in memory for provider: {}",
        provider_id
    );
}

/// Get an API key from the ephemeral in-memory cache
pub fn get_cached_api_key(provider_id: &str) -> Option<String> {
    EPHEMERAL_API_KEY_CACHE.read().get(provider_id).cloned()
}

/// Remove an API key from the ephemeral in-memory cache
pub fn remove_cached_api_key(provider_id: &str) {
    EPHEMERAL_API_KEY_CACHE.write().remove(provider_id);
}

/// Whether this launch must (re)publish the resolved master key into the
/// synchronizable transport item — set by [`init_encryption_key`]. Callers
/// MUST NOT write the item when this is false: the ecosystem key would be
/// overwritten with the local one.
pub fn should_publish_master_key() -> bool {
    PUBLISH_MASTER_KEY.get().copied().unwrap_or(false)
}
/// Get the base64-encoded master encryption key for export to peer devices.
pub fn get_master_key_b64() -> Result<String> {
    let key = get_encryption_key()?;
    Ok(general_purpose::STANDARD.encode(key))
}

/// Get the current encryption key
fn get_encryption_key() -> Result<[u8; 32]> {
    (*ENCRYPTION_KEY_CACHE.read()).ok_or_else(|| {
        anyhow::anyhow!("Encryption key not initialized. Call init_encryption_key first.")
    })
}

/// Whether a previous-generation key is held as a decrypt fallback (set
/// when the synchronizable item replaced a different local key and the
/// repair pass has not cleared it yet).
pub fn has_previous_key() -> bool {
    PREVIOUS_KEY_CACHE.read().is_some()
}

/// Drop the previous-key fallback (called after the repair pass succeeds).
pub fn clear_previous_key() {
    *PREVIOUS_KEY_CACHE.write() = None;
    let _ = keychain::delete_secret(PREVIOUS_MASTER_KEY_NAME);
}

/// Decrypt with the current key only — no fallback. The repair pass uses
/// this to distinguish rows already under the current key.
pub fn decrypt_current_only(encrypted: &str) -> Result<String> {
    chatshell_agent_core::crypto::decrypt(&get_encryption_key()?, encrypted)
}

/// Encrypt API key or sensitive data under the current master key
/// (`base64(nonce ‖ AES-256-GCM ciphertext)`, format owned by core).
pub fn encrypt(plaintext: &str) -> Result<String> {
    chatshell_agent_core::crypto::encrypt(&get_encryption_key()?, plaintext)
}

/// Decrypt API key or sensitive data produced by [`encrypt`] (or iOS via
/// FFI). Falls back to the previous-generation key when the current one
/// does not open the ciphertext — rows this device encrypted before an
/// adoption stay readable until the repair pass re-encrypts them.
pub fn decrypt(encrypted: &str) -> Result<String> {
    let current = get_encryption_key()?;
    match chatshell_agent_core::crypto::decrypt(&current, encrypted) {
        Ok(plaintext) => Ok(plaintext),
        Err(current_err) => {
            let previous = *PREVIOUS_KEY_CACHE.read();
            let fallback = previous
                .map(|key| chatshell_agent_core::crypto::decrypt(&key, encrypted))
                .transpose();
            match fallback {
                Ok(Some(plaintext)) => Ok(plaintext),
                _ => Err(current_err),
            }
        }
    }
}

/// Test seam: install explicit key material (current + optional previous)
/// and reset availability state. Production code always goes through
/// [`init_encryption_key`].
#[cfg(test)]
pub(crate) fn set_keys_for_tests(current: [u8; 32], previous: Option<[u8; 32]>) {
    *ENCRYPTION_KEY_CACHE.write() = Some(current);
    *PREVIOUS_KEY_CACHE.write() = previous;
    let _ = KEYCHAIN_AVAILABLE.set(true);
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
