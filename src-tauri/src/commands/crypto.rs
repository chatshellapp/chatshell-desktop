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
