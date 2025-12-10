use crate::crypto;

#[tauri::command]
pub async fn generate_keypair() -> Result<crypto::GeneratedKeyPair, String> {
    crypto::generate_keypair().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_keypair(public_key: String, private_key: String) -> Result<String, String> {
    crypto::export_keypair(&public_key, &private_key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_keypair(json: String) -> Result<crypto::GeneratedKeyPair, String> {
    crypto::import_keypair(&json).map_err(|e| e.to_string())
}

/// Check if the OS keychain is available for secure storage.
///
/// Returns false if:
/// - User denied keychain access
/// - No keychain service available (e.g., headless Linux without Secret Service)
///
/// When false, API keys are stored with an ephemeral key and will need to be
/// re-entered after app restart.
#[tauri::command]
pub fn is_keychain_available() -> bool {
    crypto::is_keychain_available()
}
