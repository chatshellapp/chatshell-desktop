use anyhow::Result;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ========== Content Hashing (Blake3) ==========

/// Hash binary content using Blake3 (for files, images)
pub fn hash_bytes(data: &[u8]) -> String {
    blake3::hash(data).to_hex().to_string()
}

/// Hash string content using Blake3 (for web pages, markdown)
pub fn hash_content(content: &str) -> String {
    blake3::hash(content.as_bytes()).to_hex().to_string()
}

/// Get the attachments directory path
pub fn get_attachments_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;

    let attachments_dir = app_data_dir.join("attachments");
    Ok(attachments_dir)
}

/// Get the fetch results directory path
pub fn get_fetch_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
    let attachments_dir = get_attachments_dir(app_handle)?;
    Ok(attachments_dir.join("fetch"))
}

/// Get the files directory path
pub fn get_files_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
    let attachments_dir = get_attachments_dir(app_handle)?;
    Ok(attachments_dir.join("files"))
}

/// Initialize attachment storage directories
pub fn init_storage_dirs(app_handle: &tauri::AppHandle) -> Result<()> {
    let fetch_dir = get_fetch_dir(app_handle)?;
    let files_dir = get_files_dir(app_handle)?;

    fs::create_dir_all(&fetch_dir)?;
    fs::create_dir_all(&files_dir)?;

    tracing::info!("📁 [storage] Initialized attachment directories:");
    tracing::info!("   - Fetch: {:?}", fetch_dir);
    tracing::info!("   - Files: {:?}", files_dir);

    Ok(())
}

/// Get the file extension for a content type
pub fn get_extension_for_content_type(content_type: &str) -> &'static str {
    match content_type {
        "text/markdown" => "md",
        "text/plain" => "txt",
        "text/html" => "html",
        "application/json" => "json",
        "application/pdf" => "pdf",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "bin",
    }
}

/// Generate storage path for a fetch result using content hash for deduplication
/// Uses hash as filename to enable content-based deduplication
pub fn generate_fetch_storage_path(content_hash: &str, content_type: &str) -> String {
    let ext = get_extension_for_content_type(content_type);
    format!("fetch/{}.{}", content_hash, ext)
}

/// Generate storage path for a file attachment using content hash for deduplication
/// Uses hash as filename to enable content-based deduplication
pub fn generate_file_storage_path(content_hash: &str, original_ext: &str) -> String {
    let ext = if let Some(stripped) = original_ext.strip_prefix('.') {
        stripped
    } else {
        original_ext
    };
    format!("files/{}.{}", content_hash, ext)
}

/// Get full path for a storage path
pub fn get_full_path(app_handle: &tauri::AppHandle, storage_path: &str) -> Result<PathBuf> {
    let attachments_dir = get_attachments_dir(app_handle)?;
    Ok(attachments_dir.join(storage_path))
}

/// Write content to a storage path
pub fn write_content(
    app_handle: &tauri::AppHandle,
    storage_path: &str,
    content: &str,
) -> Result<()> {
    let full_path = get_full_path(app_handle, storage_path)?;

    // Ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&full_path, content)?;
    tracing::info!(
        "💾 [storage] Wrote {} bytes to {:?}",
        content.len(),
        full_path
    );

    Ok(())
}

/// Write binary content to a storage path
pub fn write_binary(
    app_handle: &tauri::AppHandle,
    storage_path: &str,
    content: &[u8],
) -> Result<()> {
    let full_path = get_full_path(app_handle, storage_path)?;

    // Ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&full_path, content)?;
    tracing::info!(
        "💾 [storage] Wrote {} bytes (binary) to {:?}",
        content.len(),
        full_path
    );

    Ok(())
}

/// Read content from a storage path
pub fn read_content(app_handle: &tauri::AppHandle, storage_path: &str) -> Result<String> {
    let full_path = get_full_path(app_handle, storage_path)?;
    let content = fs::read_to_string(&full_path)?;
    Ok(content)
}

/// Read binary content from a storage path
pub fn read_binary(app_handle: &tauri::AppHandle, storage_path: &str) -> Result<Vec<u8>> {
    let full_path = get_full_path(app_handle, storage_path)?;
    let content = fs::read(&full_path)?;
    Ok(content)
}

/// Delete a file at a storage path
pub fn delete_file(app_handle: &tauri::AppHandle, storage_path: &str) -> Result<()> {
    let full_path = get_full_path(app_handle, storage_path)?;
    if full_path.exists() {
        fs::remove_file(&full_path)?;
        tracing::info!("🗑️ [storage] Deleted {:?}", full_path);
    }
    Ok(())
}

/// Check if a file exists at a storage path
pub fn file_exists(app_handle: &tauri::AppHandle, storage_path: &str) -> Result<bool> {
    let full_path = get_full_path(app_handle, storage_path)?;
    Ok(full_path.exists())
}

/// Get file size at a storage path
pub fn get_file_size(app_handle: &tauri::AppHandle, storage_path: &str) -> Result<u64> {
    let full_path = get_full_path(app_handle, storage_path)?;
    let metadata = fs::metadata(&full_path)?;
    Ok(metadata.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_bytes() {
        let data = b"hello world";
        let hash = hash_bytes(data);
        // Blake3 produces 64-char hex string (256 bits)
        assert_eq!(hash.len(), 64);
        // Same input should produce same hash
        assert_eq!(hash, hash_bytes(data));
        // Different input should produce different hash
        assert_ne!(hash, hash_bytes(b"hello world!"));
    }

    #[test]
    fn test_hash_content() {
        let content = "hello world";
        let hash = hash_content(content);
        assert_eq!(hash.len(), 64);
        // Should be consistent with hash_bytes for same content
        assert_eq!(hash, hash_bytes(content.as_bytes()));
    }

    #[test]
    fn test_get_extension_for_content_type() {
        assert_eq!(get_extension_for_content_type("text/markdown"), "md");
        assert_eq!(get_extension_for_content_type("text/plain"), "txt");
        assert_eq!(get_extension_for_content_type("application/json"), "json");
        assert_eq!(get_extension_for_content_type("image/png"), "png");
        assert_eq!(get_extension_for_content_type("unknown/type"), "bin");
    }

    #[test]
    fn test_generate_fetch_storage_path() {
        let hash = "a1b2c3d4e5f6";
        let path = generate_fetch_storage_path(hash, "text/markdown");
        assert_eq!(path, "fetch/a1b2c3d4e5f6.md");
    }

    #[test]
    fn test_generate_file_storage_path() {
        let hash = "x1y2z3";
        let path = generate_file_storage_path(hash, ".pdf");
        assert_eq!(path, "files/x1y2z3.pdf");

        let path2 = generate_file_storage_path(hash, "pdf");
        assert_eq!(path2, "files/x1y2z3.pdf");
    }
}
