//! Secure credential storage using OS keychain
//!
//! This module provides secure storage for sensitive credentials like API keys
//! using the operating system's native credential storage:
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: Secret Service (gnome-keyring, KWallet)

use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE_NAME: &str = "chatshell-desktop";

/// Store a credential securely in the OS keychain
///
/// # Arguments
/// * `key` - Unique identifier for the credential (e.g., "provider_openrouter_api_key")
/// * `value` - The secret value to store
pub fn store_credential(key: &str, value: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME, key).context("Failed to create keyring entry")?;

    entry
        .set_password(value)
        .context("Failed to store credential in keychain")?;

    Ok(())
}

/// Retrieve a credential from the OS keychain
///
/// # Arguments
/// * `key` - Unique identifier for the credential
///
/// # Returns
/// * `Ok(Some(value))` - Credential found
/// * `Ok(None)` - Credential not found
/// * `Err(_)` - Error accessing keychain
pub fn get_credential(key: &str) -> Result<Option<String>> {
    let entry = Entry::new(SERVICE_NAME, key).context("Failed to create keyring entry")?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow::anyhow!("Failed to retrieve credential: {}", e)),
    }
}

/// Delete a credential from the OS keychain
///
/// # Arguments
/// * `key` - Unique identifier for the credential
pub fn delete_credential(key: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME, key).context("Failed to create keyring entry")?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already deleted, that's fine
        Err(e) => Err(anyhow::anyhow!("Failed to delete credential: {}", e)),
    }
}

/// Generate a unique key for provider API keys
///
/// # Arguments
/// * `provider_id` - The provider's UUID
pub fn provider_api_key_name(provider_id: &str) -> String {
    format!("provider_{}_api_key", provider_id)
}

/// Check if the OS keychain is available and working
pub fn is_keychain_available() -> bool {
    let test_key = "__chatshell_keychain_test__";
    let test_value = "test";

    // Try to store and retrieve a test value
    let entry = match Entry::new(SERVICE_NAME, test_key) {
        Ok(e) => e,
        Err(_) => return false,
    };

    // Try to set
    if entry.set_password(test_value).is_err() {
        return false;
    }

    // Try to get
    let result = entry.get_password().is_ok();

    // Clean up
    let _ = entry.delete_credential();

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credential_lifecycle() {
        let key = "test_credential_lifecycle";
        let value = "secret_value_123";

        // Store
        store_credential(key, value).expect("Failed to store");

        // Retrieve
        let retrieved = get_credential(key).expect("Failed to get");
        assert_eq!(retrieved, Some(value.to_string()));

        // Delete
        delete_credential(key).expect("Failed to delete");

        // Verify deleted
        let after_delete = get_credential(key).expect("Failed to get after delete");
        assert_eq!(after_delete, None);
    }
}

