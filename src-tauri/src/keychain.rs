use anyhow::{Result, anyhow};
use keyring::Entry;
use std::collections::HashMap;
use std::sync::RwLock;

/// Environment variable that opts every public function in this module into
/// the in-process mock keychain backend. Set it (any non-empty value) in any
/// build or test environment where touching the real OS keychain would be
/// wrong — unit tests, integration tests, doc tests, sandboxed CI runners.
///
/// Unit tests install it automatically via `cfg!(test)`; the env var remains
/// as an escape hatch for external runners that link this crate.
const MOCK_KEYRING_ENV: &str = "CHATSHELL_TEST_MOCK_KEYRING";

/// Service name for keychain entries
const SERVICE_NAME: &str = "app.chatshell.desktop";

/// In-memory cache for secrets read from the OS keychain.
/// Avoids repeated keychain access which triggers macOS authorization dialogs,
/// especially during development where the binary signature changes on rebuild.
static SECRET_CACHE: std::sync::OnceLock<RwLock<HashMap<String, String>>> =
    std::sync::OnceLock::new();

fn cache() -> &'static RwLock<HashMap<String, String>> {
    SECRET_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

/// One-shot guard that swaps in the in-process mock credential builder.
static MOCK_KEYRING_INSTALL: std::sync::Once = std::sync::Once::new();

/// Installs the in-process mock credential builder so subsequent
/// `keyring::Entry` calls hit an in-memory store instead of the real OS
/// keychain (macOS SecKeychain, Windows Credential Manager, Linux Secret
/// Service).
///
/// The install is process-global and idempotent; later calls are no-ops.
/// Production builds never reach this function (the
/// [`install_mock_keyring_if_needed`] gate below guards every public
/// entry point), so the real keychain backend remains the default in
/// shipped builds.
pub fn install_mock_keyring() {
    MOCK_KEYRING_INSTALL.call_once(|| {
        let builder = keyring::mock::default_credential_builder();
        keyring::set_default_credential_builder(builder);
    });
}

/// Installs the mock credential builder iff [`MOCK_KEYRING_ENV`] is set in
/// the process environment. Cheap to call from every public function entry
/// point — it short-circuits when the env var is unset, and when it is set
/// the inner [`std::sync::Once`] collapses repeated calls to a single
/// install.
#[inline]
fn install_mock_keyring_if_needed() {
    // Unit tests (`cargo test` on this crate) compile with cfg(test), so the
    // mock installs automatically. The env var remains as an escape hatch for
    // external runners that link this crate without cfg(test). It MUST NOT be
    // exported via .cargo/config.toml [env]: that table applies to every
    // cargo invocation, including `tauri dev`, where the mock would silently
    // replace the real keychain and break decryption of persisted secrets.
    if cfg!(test) || std::env::var_os(MOCK_KEYRING_ENV).is_some() {
        install_mock_keyring();
    }
}

/// Store a secret in the OS keychain and update the in-memory cache.
pub fn set_secret(key: &str, secret: &str) -> Result<()> {
    install_mock_keyring_if_needed();

    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| anyhow!("Failed to create keyring entry: {}", e))?;

    entry
        .set_password(secret)
        .map_err(|e| anyhow!("Failed to store secret: {}", e))?;

    if let Ok(mut c) = cache().write() {
        c.insert(key.to_string(), secret.to_string());
    }

    tracing::info!("🔐 [keychain] Stored secret for key: {}", key);
    Ok(())
}

/// Retrieve a secret, returning the in-memory cached value when available
/// to avoid triggering the macOS keychain authorization dialog repeatedly.
pub fn get_secret(key: &str) -> Result<Option<String>> {
    install_mock_keyring_if_needed();

    if let Ok(c) = cache().read()
        && let Some(v) = c.get(key)
    {
        return Ok(Some(v.clone()));
    }

    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| anyhow!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(password) => {
            if let Ok(mut c) = cache().write() {
                c.insert(key.to_string(), password.clone());
            }
            Ok(Some(password))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow!("Failed to retrieve secret: {}", e)),
    }
}

/// Delete a secret from the OS keychain and the in-memory cache.
#[allow(dead_code)]
pub fn delete_secret(key: &str) -> Result<()> {
    install_mock_keyring_if_needed();

    if let Ok(mut c) = cache().write() {
        c.remove(key);
    }

    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| anyhow!("Failed to create keyring entry: {}", e))?;

    match entry.delete_credential() {
        Ok(()) => {
            tracing::info!("🔐 [keychain] Deleted secret for key: {}", key);
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow!("Failed to delete secret: {}", e)),
    }
}

/// Check if the OS keychain is available
#[allow(dead_code)]
pub fn is_keychain_available() -> bool {
    install_mock_keyring_if_needed();
    Entry::new(SERVICE_NAME, "availability_check").is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_and_get_secret() {
        let test_key = "test_secret_key_manual";
        let test_value = "test_secret_value";

        // Clean up any existing entry
        let _ = delete_secret(test_key);

        // Set the secret
        set_secret(test_key, test_value).expect("Failed to set secret");

        // Get the secret
        let retrieved = get_secret(test_key)
            .expect("Failed to get secret")
            .expect("Secret not found");

        assert_eq!(retrieved, test_value);

        // Clean up
        delete_secret(test_key).expect("Failed to delete secret");
    }

    #[test]
    fn test_entry_creation() {
        // Just verify that Entry creation works (doesn't require keychain access)
        let result = Entry::new(SERVICE_NAME, "test_key");
        assert!(result.is_ok(), "Failed to create keyring entry");
    }
}
