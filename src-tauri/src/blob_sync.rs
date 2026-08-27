//! Blob sidecar transport (ADR 02; Tier 2 carrier is ciphertext per ADR 04
//! §5).
//!
//! Attachment bytes never enter snapshot.db. `files.content_hash` carries a
//! BLAKE3 hex digest (see `storage::hash_bytes`); the bytes travel as
//! content-addressed sidecar files (`<cloud>/blobs/<hash>`), uploaded before
//! any snapshot referencing them, so peers never see a dangling reference
//! through the normal publish path. Identical content means identical file
//! name, and encryption is deterministic in the digest, so concurrent
//! uploads from two devices still write byte-identical ciphertext — iCloud
//! conflict copies and folder-sync conflicts cannot occur.
//!
//! Filenames remain `blake3(plaintext)`: dedup, GC, the fetch `gone`
//! status, and budget logic are untouched. The pre-encrypt
//! `blake3(plaintext) == filename` assertion lives in core
//! `sync_crypto::encrypt_blob` (same-name-different-bytes would be GCM
//! nonce reuse — catastrophic); fetch verifies the hash again after
//! decryption. Budget accounting uses ciphertext byte counts (the actual
//! download cost). An unexpected magic is an error, never a plaintext
//! parse.

use anyhow::Context;
use chatshell_agent_core::sync_crypto::{ContentKeys, SyncCryptoError};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const BLOB_DIR: &str = "blobs";

/// Orphan blobs younger than this are kept: a peer may be about to reference
/// them (upload-before-publish ordering, bird propagation lag, conflict
/// copies still settling).
pub const GC_GRACE_SECS: u64 = 14 * 24 * 60 * 60;

/// Hard cap on a single attachment shipped through the sidecar; larger files
/// are almost certainly not chat attachments and would stall the sync pass.
const MAX_BLOB_BYTES: u64 = 256 * 1024 * 1024;

/// Fetch-on-open budget (plan §5): at most 20 items / 50 MB per pass.
/// Overflow stays fetchable on demand (click) instead of downloading
/// the whole history at open.
pub const FETCH_ITEM_BUDGET: usize = 20;
pub const FETCH_BYTE_BUDGET: u64 = 50 * 1024 * 1024;

fn blob_path(cloud_dir: &Path, hash: &str) -> PathBuf {
    cloud_dir.join(BLOB_DIR).join(hash)
}

/// Resolve a stored `files.storage_path` against the local attachments dir.
/// Desktop rows are relative (`files/<hash>.<ext>`); rows merged from iOS
/// carry absolute paths into the authoring device's sandbox - those are kept
/// as-is and simply will not exist locally, which is what the fetch pass
/// repairs.
fn resolve_local_path(base_dir: &Path, storage_path: &str) -> PathBuf {
    let p = Path::new(storage_path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base_dir.join(p)
    }
}

/// Copy every live file row's bytes into the container blob store.
///
/// Returns the number of blobs newly written. Existing destination files are
/// left untouched (content addressing makes them identical by construction).
/// Each uploaded file's BLAKE3 is verified against `content_hash` before it
/// ships under that name - a mismatch means the local path no longer holds
/// the hashed bytes, and shipping them anyway would corrupt the peer's view.
pub async fn ensure_referenced_blobs_uploaded(
    db: &crate::db::Database,
    cloud_dir: &Path,
    base_dir: &Path,
    keys: &ContentKeys,
) -> anyhow::Result<usize> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT storage_path, content_hash FROM files \
         WHERE deleted_at IS NULL AND content_hash IS NOT NULL AND storage_path IS NOT NULL",
    )
    .fetch_all(db.pool())
    .await?;

    let blobs_dir = cloud_dir.join(BLOB_DIR);
    std::fs::create_dir_all(&blobs_dir)
        .with_context(|| format!("provision {}", blobs_dir.display()))?;

    let mut uploaded = 0usize;
    for (storage_path, hash) in rows {
        let dest = blob_path(cloud_dir, &hash);
        if dest.exists() {
            continue;
        }
        let src = resolve_local_path(base_dir, &storage_path);
        let meta = match std::fs::metadata(&src) {
            Ok(m) => m,
            Err(err) => {
                tracing::warn!("Blob source {} unreadable, skipped: {err}", storage_path);
                continue;
            }
        };
        if meta.len() > MAX_BLOB_BYTES {
            tracing::warn!(
                "Blob source {} is {} bytes, above the {} byte cap; skipped",
                storage_path,
                meta.len(),
                MAX_BLOB_BYTES
            );
            continue;
        }
        let bytes = match std::fs::read(&src) {
            Ok(b) => b,
            Err(err) => {
                tracing::warn!("Blob source {} unreadable, skipped: {err}", storage_path);
                continue;
            }
        };
        if crate::storage::hash_bytes(&bytes) != hash {
            tracing::warn!(
                "Blob source {} does not match its content hash; skipped",
                storage_path
            );
            continue;
        }
        // Encrypt under the content key. The pre-encrypt hash assertion
        // above is what makes the deterministic per-blob nonce safe; core
        // re-asserts it (security-critical, single implementation point).
        let sealed = match chatshell_agent_core::sync_crypto::encrypt_blob(keys, &hash, &bytes) {
            Ok(sealed) => sealed,
            Err(err) => {
                tracing::warn!("Blob {} failed to encrypt; skipped: {err}", hash);
                continue;
            }
        };
        // Temp-in-destination-dir + rename keeps a partial upload from ever
        // being visible under the content-addressed name.
        // Unique per upload: concurrent engines sharing the container must
        // not truncate/rename each other's partial temp into the
        // content-addressed destination (a corrupt blob there blocks
        // re-upload forever because dest.exists() skips).
        let tmp = dest.with_extension(format!("tmp-{}", uuid::Uuid::now_v7()));
        if std::fs::write(&tmp, &sealed)
            .and_then(|_| std::fs::rename(&tmp, &dest))
            .is_err()
        {
            let _ = std::fs::remove_file(&tmp);
            tracing::warn!("Failed to write blob {} into the container", hash);
            continue;
        }
        uploaded += 1;
    }
    if uploaded > 0 {
        tracing::info!("Uploaded {uploaded} new blob(s) to the container");
    }
    Ok(uploaded)
}

/// Fetch-on-open (plan §5): materialize the attachment bytes a conversation
/// references, newest message first, within the item/byte budget.
///
/// Per hash: bytes already on disk -> `cached`; sidecar copy present ->
/// verify BLAKE3, write them into the local attachments dir, and repair the
/// referencing rows' `storage_path` (iOS-authored rows carry absolute paths
/// into their own sandbox); no device holds the bytes -> `gone`; outside the
/// budget -> `skipped` (still fetchable per item on demand).
pub async fn fetch_conversation_blobs(
    db: &crate::db::Database,
    cloud_dir: &Path,
    base_dir: &Path,
    conversation_id: &str,
    keys: &ContentKeys,
) -> anyhow::Result<FetchOutcome> {
    let rows = sqlx::query_as::<_, (String, String, String, i64)>(
        "SELECT f.content_hash, f.storage_path, f.mime_type, f.file_size \
         FROM message_attachments ma \
         JOIN messages m ON m.id = ma.message_id \
         JOIN files f ON f.id = ma.attachment_id \
         WHERE m.conversation_id = ?1 AND ma.deleted_at IS NULL AND m.deleted_at IS NULL \
           AND f.deleted_at IS NULL AND f.content_hash IS NOT NULL AND f.content_hash != '' \
         ORDER BY m.created_at DESC, ma.display_order ASC, f.created_at ASC",
    )
    .bind(conversation_id)
    .fetch_all(db.pool())
    .await?;

    // Group by hash preserving newest-first order; several file rows can
    // share one hash across devices with different storage_path spellings.
    let mut order: Vec<String> = Vec::new();
    let mut by_hash: HashMap<String, Vec<(String, String, i64)>> = HashMap::new();
    for (hash, storage_path, mime_type, file_size) in rows {
        if by_hash.insert(hash.clone(), vec![]).is_none() {
            order.push(hash.clone());
        }
        by_hash
            .get_mut(&hash)
            .unwrap()
            .push((storage_path, mime_type, file_size));
    }

    let mut statuses = Vec::with_capacity(order.len());
    let mut repairs: Vec<(String, String)> = Vec::new();
    let mut needs_unlock = false;
    let mut item_budget = FETCH_ITEM_BUDGET;
    let mut byte_budget = FETCH_BYTE_BUDGET;

    for hash in order {
        let refs = &by_hash[&hash];
        // Already materialized locally under any of this hash's paths?
        if refs
            .iter()
            .any(|(sp, _, _)| resolve_local_path(base_dir, sp).is_file())
        {
            statuses.push(crate::models::BlobFetchStatus {
                content_hash: hash,
                status: "cached".into(),
            });
            continue;
        }

        // Budget on ciphertext bytes — the actual download cost (ADR 04 §5).
        let blob = blob_path(cloud_dir, &hash);
        let size = std::fs::metadata(&blob)
            .map(|m| m.len())
            .unwrap_or_else(|_| refs.iter().map(|(_, _, s)| *s).max().unwrap_or(0).max(0) as u64);
        if item_budget == 0 || size > byte_budget {
            statuses.push(crate::models::BlobFetchStatus {
                content_hash: hash,
                status: "skipped".into(),
            });
            continue;
        }

        match std::fs::read(&blob) {
            Ok(sealed) if sealed.len() as u64 <= MAX_BLOB_BYTES => {
                let bytes =
                    match chatshell_agent_core::sync_crypto::decrypt_blob(keys, &hash, &sealed) {
                        Ok(bytes) => bytes,
                        Err(SyncCryptoError::UnknownKeyVersion(version)) => {
                            // Rotated elsewhere (or this device never learned the
                            // version): the acquisition ladder must run before
                            // these bytes can ever materialize.
                            tracing::warn!(
                                "Blob {} needs content key v{version}; unlock required",
                                hash
                            );
                            needs_unlock = true;
                            statuses.push(crate::models::BlobFetchStatus {
                                content_hash: hash,
                                status: "gone".into(),
                            });
                            continue;
                        }
                        Err(err) => {
                            tracing::warn!(
                                "Blob {} failed to decrypt; not materializing: {err}",
                                hash
                            );
                            statuses.push(crate::models::BlobFetchStatus {
                                content_hash: hash,
                                status: "gone".into(),
                            });
                            continue;
                        }
                    };
                // Derive the local relative path from an existing extension
                // when available, else from the mime type.
                let ext = refs
                    .iter()
                    .find_map(|(sp, _, _)| Path::new(sp).extension().and_then(|e| e.to_str()))
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        crate::storage::get_extension_for_content_type(&refs[0].1).to_string()
                    });
                let rel = crate::storage::generate_file_storage_path(&hash, &ext);
                let dest = resolve_local_path(base_dir, &rel);
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent)
                        .with_context(|| format!("provision {}", parent.display()))?;
                }
                // Temp + rename: a partially written file never becomes visible.
                let tmp = dest.with_extension("tmp-fetching");
                std::fs::write(&tmp, &bytes)
                    .and_then(|_| std::fs::rename(&tmp, &dest))
                    .with_context(|| format!("materialize blob {}", hash))?;

                item_budget -= 1;
                byte_budget -= size;
                repairs.push((hash.clone(), rel));
                statuses.push(crate::models::BlobFetchStatus {
                    content_hash: hash,
                    status: "fetched".into(),
                });
            }
            Ok(_) => {
                tracing::warn!("Blob {} exceeds the {} byte cap", hash, MAX_BLOB_BYTES);
                statuses.push(crate::models::BlobFetchStatus {
                    content_hash: hash,
                    status: "gone".into(),
                });
            }
            Err(_) => {
                statuses.push(crate::models::BlobFetchStatus {
                    content_hash: hash,
                    status: "gone".into(),
                });
            }
        }
    }

    // Repair peer-authored storage paths so rendering resolves locally. Only
    // rows that actually differ are touched, and updated_at is bumped so the
    // repair converges back to peers through the normal LWW merge.
    for (hash, rel) in repairs {
        sqlx::query(
            "UPDATE files SET storage_path = ?1, updated_at = ?2 \
             WHERE content_hash = ?3 AND deleted_at IS NULL AND storage_path != ?4",
        )
        .bind(&rel)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&hash)
        .bind(&rel)
        .execute(db.pool())
        .await?;
    }

    Ok(FetchOutcome {
        statuses,
        needs_unlock,
    })
}

/// Result of one fetch pass: per-hash statuses plus whether any blob needed
/// a content-key version this device does not hold (the acquisition ladder
/// must run before those bytes can materialize).
#[derive(Debug, Default)]
pub struct FetchOutcome {
    pub statuses: Vec<crate::models::BlobFetchStatus>,
    pub needs_unlock: bool,
}

/// Remove orphan blobs older than the grace period: entries in the container
/// blob store whose digest no longer appears in any live `files` row.
pub async fn gc_orphan_blobs(
    db: &crate::db::Database,
    cloud_dir: &Path,
    grace_secs: u64,
) -> anyhow::Result<usize> {
    let live: std::collections::HashSet<String> = sqlx::query_scalar(
        "SELECT DISTINCT content_hash FROM files \
         WHERE deleted_at IS NULL AND content_hash IS NOT NULL",
    )
    .fetch_all(db.pool())
    .await?
    .into_iter()
    .collect();

    let blobs_dir = cloud_dir.join(BLOB_DIR);
    let mut removed = 0usize;
    for entry in std::fs::read_dir(&blobs_dir)?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // A crashed peer may leave `<hash>.tmp-uploading` behind; those are
        // reclaimable under the same grace rule, keyed by their hash.
        let hash = name
            .strip_suffix(".tmp-uploading")
            .map(String::from)
            .or_else(|| {
                name.rsplit_once(".tmp-")
                    .filter(|(h, _)| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
                    .map(|(h, _)| h.to_string())
            })
            .unwrap_or_else(|| name.to_string());
        if live.contains(hash.as_str()) {
            continue;
        }
        let age_ok = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age.as_secs() >= grace_secs);
        if age_ok {
            match std::fs::remove_file(&path) {
                Ok(()) => removed += 1,
                Err(err) => tracing::warn!("Blob GC could not remove {}: {err}", path.display()),
            }
        }
    }
    if removed > 0 {
        tracing::info!("Blob GC removed {removed} orphan(s)");
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    use tempfile::TempDir;

    async fn test_db(tag: &str) -> (crate::db::Database, PathBuf, TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::Database::new(dir.path().join(format!("{tag}.db")).to_str().unwrap())
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                mime_type TEXT NOT NULL,
                storage_path TEXT NOT NULL,
                content_hash TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '',
                deleted_at TEXT
            )",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                sender_type TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '',
                deleted_at TEXT
            )",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS message_attachments (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                attachment_type TEXT NOT NULL,
                attachment_id TEXT NOT NULL,
                display_order INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '',
                deleted_at TEXT
            )",
        )
        .execute(db.pool())
        .await
        .unwrap();
        let cloud = dir.path().join("cloud");
        std::fs::create_dir_all(&cloud).unwrap();
        (db, cloud, dir)
    }

    fn test_keys() -> chatshell_agent_core::sync_crypto::ContentKeys {
        let crypto = chatshell_agent_core::sync_crypto::SyncCrypto::bootstrap_with_params(
            "blob test passphrase",
            chatshell_agent_core::sync_crypto::ArgonParams::test(),
        )
        .unwrap();
        crypto.keys().clone()
    }

    #[tokio::test]
    async fn uploads_verified_blobs_and_skips_existing() {
        let (db, cloud, _dir) = test_db("upload").await;
        let content = b"attachment-bytes".to_vec();
        let hash = crate::storage::hash_bytes(&content);
        let src = cloud.join("src-attachment.bin");
        std::fs::write(&src, &content).unwrap();
        sqlx::query(
            "INSERT INTO files VALUES ('f1','a.bin',16,'application/octet-stream',?1,?2,'2026-01-01','',NULL)",
        )
        .bind(src.to_string_lossy().as_ref())
        .bind(&hash)
        .execute(db.pool())
        .await
        .unwrap();

        let keys = test_keys();
        let uploaded = ensure_referenced_blobs_uploaded(&db, &cloud, &cloud, &keys)
            .await
            .unwrap();
        assert_eq!(uploaded, 1);
        let blob = cloud.join(BLOB_DIR).join(&hash);
        assert!(blob.exists());
        // The sidecar carries ciphertext, not the plaintext attachment.
        let raw = std::fs::read(&blob).unwrap();
        assert_ne!(raw, content);
        assert_eq!(&raw[..8], chatshell_agent_core::sync_crypto::BLOB_MAGIC);
        // Deterministic: re-encrypting under the same key yields identical
        // bytes (concurrent uploads never conflict).
        assert_eq!(crypto_encrypt_again(&keys, &hash, &content), raw);
        // Second pass: already present, nothing to do.
        let uploaded = ensure_referenced_blobs_uploaded(&db, &cloud, &cloud, &keys)
            .await
            .unwrap();
        assert_eq!(uploaded, 0);
    }

    fn crypto_encrypt_again(
        keys: &chatshell_agent_core::sync_crypto::ContentKeys,
        hash: &str,
        content: &[u8],
    ) -> Vec<u8> {
        chatshell_agent_core::sync_crypto::encrypt_blob(keys, hash, content).unwrap()
    }

    #[tokio::test]
    async fn hash_mismatch_is_not_shipped() {
        let (db, cloud, _dir) = test_db("mismatch").await;
        let src = cloud.join("tampered.bin");
        std::fs::write(&src, b"actual bytes").unwrap();
        sqlx::query(
            "INSERT INTO files VALUES ('f1','a.bin',11,'application/octet-stream',?1,'deadbeef','2026-01-01','',NULL)",
        )
        .bind(src.to_string_lossy().as_ref())
        .execute(db.pool())
        .await
        .unwrap();

        let uploaded = ensure_referenced_blobs_uploaded(&db, &cloud, &cloud, &test_keys())
            .await
            .unwrap();
        assert_eq!(uploaded, 0);
    }

    #[tokio::test]
    async fn gc_respects_grace_and_live_hashes() {
        let (db, cloud, _dir) = test_db("gc").await;
        // An orphan blob with zero grace: removable.
        let orphan = cloud.join(BLOB_DIR).join("a".repeat(64));
        std::fs::create_dir_all(cloud.join(BLOB_DIR)).unwrap();
        std::fs::write(&orphan, b"orphan").unwrap();
        gc_orphan_blobs(&db, &cloud, 0).await.unwrap();
        assert!(!orphan.exists());

        // A live hash is never removed even at zero grace.
        let live_hash = crate::storage::hash_bytes(b"live");
        let live_blob = cloud.join(BLOB_DIR).join(&live_hash);
        std::fs::write(&live_blob, b"live").unwrap();
        sqlx::query(
            "INSERT INTO files VALUES ('f2','l.bin',4,'application/octet-stream','nowhere',?1,'2026-01-01','',NULL)",
        )
        .bind(&live_hash)
        .execute(db.pool())
        .await
        .unwrap();
        gc_orphan_blobs(&db, &cloud, 0).await.unwrap();
        assert!(live_blob.exists());
    }

    /// Seed one conversation with one message and N file rows; returns hashes.
    async fn seed_conversation(
        db: &crate::db::Database,
        conversation_id: &str,
        message_created_at: &str,
        file_rows: &[(&str, i64)], // (content_hash, file_size)
    ) {
        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at) \
             VALUES (?1, 'test', ?2, ?2)",
        )
        .bind(conversation_id)
        .bind(message_created_at)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO messages (id, conversation_id, sender_type, content, created_at) \
             VALUES ('m1', ?1, 'user', 'hi', ?2)",
        )
        .bind(conversation_id)
        .bind(message_created_at)
        .execute(db.pool())
        .await
        .unwrap();
        for (i, (hash, size)) in file_rows.iter().enumerate() {
            let file_id = format!("f{i}");
            sqlx::query(
                "INSERT INTO files (id, file_name, file_size, mime_type, storage_path, content_hash, created_at) \
                 VALUES (?1, 'a.bin', ?2, 'image/png', 'gone', ?3, '2026-01-01')",
            )
            .bind(&file_id)
            .bind(size)
            .bind(hash)
            .execute(db.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO message_attachments (id, message_id, attachment_type, attachment_id, display_order, created_at) \
                 VALUES (?1, 'm1', 'file', ?2, 0, '2026-01-01')",
            )
            .bind(format!("ma{i}"))
            .bind(&file_id)
            .execute(db.pool())
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn fetch_materializes_blobs_and_repairs_paths() {
        let (db, cloud, dir) = test_db("fetch").await;
        let attach = dir.path().join("attach");
        let content = b"fetched-bytes".to_vec();
        let hash = crate::storage::hash_bytes(&content);
        std::fs::create_dir_all(cloud.join(BLOB_DIR)).unwrap();
        // Seed the sidecar the way the upload path now writes it: ciphertext.
        let crypto = chatshell_agent_core::sync_crypto::SyncCrypto::bootstrap_with_params(
            "blob test passphrase",
            chatshell_agent_core::sync_crypto::ArgonParams::test(),
        )
        .unwrap();
        let sealed = crypto.encrypt_blob(&hash, &content).unwrap();
        std::fs::write(cloud.join(BLOB_DIR).join(&hash), &sealed).unwrap();
        let keys = crypto.keys().clone();
        // iOS-authored row: absolute path into a foreign sandbox.
        seed_conversation(&db, "c1", "2026-01-02T00:00:00Z", &[(&hash.clone(), 13)]).await;
        sqlx::query("UPDATE files SET storage_path = '/var/mobile/sandbox/files/x.png' WHERE content_hash = ?1")
            .bind(&hash)
            .execute(db.pool())
            .await
            .unwrap();

        let statuses = fetch_conversation_blobs(&db, &cloud, &attach, "c1", &keys)
            .await
            .unwrap();
        assert_eq!(statuses.statuses.len(), 1);
        assert_eq!(statuses.statuses[0].status, "fetched");
        assert!(!statuses.needs_unlock);
        // Bytes materialized at the hash-derived relative path; the row now
        // points there instead of the foreign sandbox path.
        assert!(attach.join("files").join(format!("{hash}.png")).exists());
        let stored: String =
            sqlx::query_scalar("SELECT storage_path FROM files WHERE content_hash = ?1")
                .bind(&hash)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(stored, format!("files/{hash}.png"));
        // Second pass: cached, no rework.
        let statuses = fetch_conversation_blobs(&db, &cloud, &attach, "c1", &keys)
            .await
            .unwrap();
        assert_eq!(statuses.statuses[0].status, "cached");
    }

    #[tokio::test]
    async fn fetch_reports_gone_when_no_device_holds_bytes() {
        let (db, cloud, dir) = test_db("gone").await;
        let attach = dir.path().join("attach");
        let hash = crate::storage::hash_bytes(b"never-shipped");
        seed_conversation(&db, "c1", "2026-01-02T00:00:00Z", &[(&hash.clone(), 13)]).await;

        let statuses = fetch_conversation_blobs(&db, &cloud, &attach, "c1", &test_keys())
            .await
            .unwrap();
        assert_eq!(statuses.statuses.len(), 1);
        assert_eq!(statuses.statuses[0].status, "gone");
    }

    #[tokio::test]
    async fn fetch_budget_overflow_is_skipped_not_gone() {
        let (db, cloud, dir) = test_db("budget").await;
        let attach = dir.path().join("attach");
        let big = vec![0u8; 60 * 1024 * 1024];
        let hash = crate::storage::hash_bytes(&big);
        std::fs::create_dir_all(cloud.join(BLOB_DIR)).unwrap();
        std::fs::write(cloud.join(BLOB_DIR).join(&hash), &big).unwrap();
        seed_conversation(
            &db,
            "c1",
            "2026-01-02T00:00:00Z",
            &[(&hash.clone(), big.len() as i64)],
        )
        .await;

        let statuses = fetch_conversation_blobs(&db, &cloud, &attach, "c1", &test_keys())
            .await
            .unwrap();
        assert_eq!(statuses.statuses[0].status, "skipped");
        assert!(!attach.join("files").exists());
    }
}
