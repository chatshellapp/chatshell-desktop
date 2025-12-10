use anyhow::{anyhow, Result};
use keyring::Entry;

/// Service name for keychain entries
const SERVICE_NAME: &str = "app.chatshell.desktop";

/// Store a secret in the OS keychain
pub fn set_secret(key: &str, secret: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| anyhow!("Failed to create keyring entry: {}", e))?;

    entry
        .set_password(secret)
        .map_err(|e| anyhow!("Failed to store secret: {}", e))?;

    tracing::info!("🔐 [keychain] Stored secret for key: {}", key);
    Ok(())
}

/// Retrieve a secret from the OS keychain
pub fn get_secret(key: &str) -> Result<Option<String>> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| anyhow!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow!("Failed to retrieve secret: {}", e)),
    }
}

/// Delete a secret from the OS keychain
#[allow(dead_code)]
pub fn delete_secret(key: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| anyhow!("Failed to create keyring entry: {}", e))?;

    match entry.delete_credential() {
        Ok(()) => {
            tracing::info!("🔐 [keychain] Deleted secret for key: {}", key);
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()), // Already deleted
        Err(e) => Err(anyhow!("Failed to delete secret: {}", e)),
    }
}

/// Check if the OS keychain is available
#[allow(dead_code)]
pub fn is_keychain_available() -> bool {
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

