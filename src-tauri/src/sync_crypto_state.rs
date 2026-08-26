//! Desktop content-key (CK) lifecycle and sync-enablement state (ADR 04 §3,
//! §7).
//!
//! The graded CK acquisition ladder, identical in shape on every platform:
//! synchronizable Keychain item (Apple) → locally cached chain → silent
//! retry with backoff (the sync tick re-runs this ladder — Keychain
//! propagation delay is normal, not failure) → non-blocking banner prompting
//! the passphrase. Launch is never blocked; the app renders local data and
//! an explanatory placeholder until unlock.
//!
//! Enablement is device-local (a JSON record in the app data dir, never a
//! synced table): silent-on is rejected — enabling includes consent, the
//! passphrase bootstrap, and recovery education, and cloud artifacts consume
//! the user's iCloud quota.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chatshell_agent_core::sync::ENCRYPTED_SNAPSHOT_FILE;
use chatshell_agent_core::sync_crypto::{ContentKeys, SyncCrypto, SyncCryptoError};
use serde::{Deserialize, Serialize};

/// Device-local enablement record. Lives in the app data dir; never synced.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncSettings {
    pub enabled: bool,
    pub onboarded: bool,
    /// Times the user declined the onboarding card. ADR 04 §7: declined is
    /// treated as off; asked once more at next launch; afterwards a
    /// settings item only.
    pub declined_count: u32,
    /// Ladder state: the artifact failed to unwrap under every held key
    /// (sync group reset elsewhere), so acquisition re-enters at the
    /// passphrase rung — never an error loop.
    pub needs_unlock: bool,
}

const SETTINGS_FILE: &str = "sync-settings.json";
const CHAIN_CACHE: &str = "sync-ck-chain.bin";

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SETTINGS_FILE)
}

pub fn load_settings(app_data_dir: &Path) -> SyncSettings {
    std::fs::read(settings_path(app_data_dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save_settings(app_data_dir: &Path, settings: &SyncSettings) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(settings).context("serialize sync settings")?;
    std::fs::write(settings_path(app_data_dir), bytes)
        .with_context(|| format!("write {}", settings_path(app_data_dir).display()))
}

pub fn chain_cache_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CHAIN_CACHE)
}

/// Path of the encrypted transport artifact inside a cloud dir.
pub fn artifact_path(cloud_dir: &Path) -> PathBuf {
    cloud_dir.join(ENCRYPTED_SNAPSHOT_FILE)
}

/// What the acquisition ladder found for this device right now.
#[derive(Debug)]
pub enum CkResolution {
    /// A usable crypto state — ready to construct the engine.
    Ready(SyncCrypto),
    /// No artifact and no key anywhere: the sync group must be bootstrapped
    /// (onboarding owns the passphrase step, even on Apple).
    NeedBootstrap,
    /// An artifact exists but no rung produced a key: surface the
    /// non-blocking passphrase banner.
    NeedPassphrase,
}

#[cfg(target_os = "macos")]
fn keychain_content_key() -> Option<String> {
    crate::sync_keychain::get_synchronizable_content_key()
}

#[cfg(not(target_os = "macos"))]
fn keychain_content_key() -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn publish_keychain_content_key(value_b64: &str) {
    if let Err(err) = crate::sync_keychain::set_synchronizable_content_key(value_b64) {
        tracing::warn!("Failed to store the synchronizable content key: {err:?}");
    }
}

#[cfg(not(target_os = "macos"))]
fn publish_keychain_content_key(_value_b64: &str) {}

fn decode_key_b64(value: &str) -> Option<[u8; 32]> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD
        .decode(value)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
}

fn current_key_b64(crypto: &SyncCrypto) -> String {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD.encode(crypto.keys().current_key())
}

/// Slots + declared key version carried by the remote artifact, when one
/// exists. Slots are public ciphertext: every publish carries them forward
/// so passphrase-only peers keep their fallback (ADR 04 §4).
fn carried_slots(cloud_dir: &Path) -> (Vec<chatshell_agent_core::sync_crypto::ArgonSlot>, u32) {
    match chatshell_agent_core::sync_crypto::read_artifact_header(&artifact_path(cloud_dir)) {
        Ok(header) => (header.slots, header.key_version),
        Err(_) => (Vec::new(), 1),
    }
}

/// Persist the chain into the device-local cache. The file sits beside the
/// plaintext local DB by design (ADR 04 §2): the neighboring database is
/// already plaintext, so the cache adds no local exposure — the CK exists
/// solely to protect the cloud copy.
pub fn persist_chain(app_data_dir: &Path, crypto: &SyncCrypto) -> Result<()> {
    let path = chain_cache_path(app_data_dir);
    std::fs::write(&path, crypto.keys().encode())
        .with_context(|| format!("write {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Persist the chain and republish the current key into the synchronizable
/// item (mint or item-absent paths — steady state never writes, mirroring
/// the master-key rule against loser-overwrites-winner).
fn persist_all(app_data_dir: &Path, crypto: &SyncCrypto) -> Result<()> {
    persist_chain(app_data_dir, crypto)?;
    // Write the synchronizable item only when absent (mint or a failed
    // mint-time write being retried): steady state never writes — an
    // unconditional write-back would overwrite the ecosystem key with a
    // stale local one whenever the item read transiently fails.
    let key_b64 = current_key_b64(crypto);
    if keychain_content_key().is_none() {
        publish_keychain_content_key(&key_b64);
    }
    Ok(())
}

/// Run the graded acquisition ladder (ADR 04 §3 rule 2). When
/// `settings.needs_unlock` is set (artifact failed to unwrap under held
/// keys), the ladder re-enters directly at the passphrase rung.
pub fn resolve_content_key(
    app_data_dir: &Path,
    cloud_dir: &Path,
    settings: &SyncSettings,
) -> CkResolution {
    let has_artifact = artifact_path(cloud_dir).is_file();
    if settings.needs_unlock {
        return if has_artifact {
            CkResolution::NeedPassphrase
        } else {
            // No artifact left (cloud data deleted): a fresh bootstrap is
            // the only coherent next step.
            CkResolution::NeedBootstrap
        };
    }

    // Rung 1: iCloud Keychain synchronizable item (Apple platforms). A
    // fresh adopter learns the current key version from the artifact
    // header; a stale item fails at first decrypt and re-enters the ladder
    // at the passphrase rung.
    if let Some(value) = keychain_content_key()
        && let Some(ck) = decode_key_b64(&value)
    {
        let (slots, version) = carried_slots(cloud_dir);
        if let Ok(keys) = ContentKeys::from_entries(vec![(version, ck)])
            && let Ok(crypto) = SyncCrypto::from_keys(keys, slots, true)
        {
            return CkResolution::Ready(crypto);
        }
    }

    // Rung 2: locally cached chain (full version history — also the only
    // place old post-rotation keys survive on this device).
    if let Ok(bytes) = std::fs::read(chain_cache_path(app_data_dir))
        && let Ok(keys) = ContentKeys::decode(&bytes)
    {
        let (slots, _) = carried_slots(cloud_dir);
        if let Ok(crypto) = SyncCrypto::from_keys(keys, slots, true) {
            return CkResolution::Ready(crypto);
        }
    }

    // Rung 3 is time: the sync tick re-runs this ladder silently (backoff),
    // because Keychain propagation delay is normal. Rung 4 is the banner.
    if has_artifact {
        CkResolution::NeedPassphrase
    } else {
        CkResolution::NeedBootstrap
    }
}

/// First device of a sync group: mint a CK and wrap it under the group
/// passphrase. Bootstrap requires the passphrase even on Apple (ADR 04 §3
/// rule 1) — otherwise the fallback does not exist when the Keychain slot
/// fails.
pub fn bootstrap_group(app_data_dir: &Path, passphrase: &str) -> Result<SyncCrypto> {
    let crypto = SyncCrypto::bootstrap(passphrase.trim())?;
    persist_all(app_data_dir, &crypto)?;
    tracing::info!("Sync group bootstrapped (content key v1)");
    Ok(crypto)
}

/// Passphrase rung: unwrap the remote artifact's slot chain into the full
/// key chain (unioned with the local cache), then persist both stores and
/// clear the needs-unlock latch.
pub fn unlock_with_passphrase(
    app_data_dir: &Path,
    cloud_dir: &Path,
    passphrase: &str,
) -> Result<SyncCrypto> {
    let header = chatshell_agent_core::sync_crypto::read_artifact_header(&artifact_path(cloud_dir))
        .map_err(anyhow::Error::new)
        .context("read the cloud artifact header")?;
    let known = std::fs::read(chain_cache_path(app_data_dir))
        .ok()
        .and_then(|bytes| ContentKeys::decode(&bytes).ok());
    let crypto = SyncCrypto::from_passphrase(&header, passphrase.trim(), known.as_ref(), true)?;
    persist_all(app_data_dir, &crypto)?;
    let mut settings = load_settings(app_data_dir);
    settings.needs_unlock = false;
    save_settings(app_data_dir, &settings)?;
    tracing::info!("Sync content key unlocked via passphrase");
    Ok(crypto)
}

/// Explicit user action only (suspected compromise, lost device): mint the
/// next CK under the passphrase. Forward-only revocation — snapshots and
/// blobs written afterwards are protected from a holder of the old CK;
/// blobs last written before the rotation stay readable to them (ADR 04 §5).
/// Chain trimming (dropping CK versions no live blob carries) is deferred —
/// retaining old keys is always safe and rotation is rare.
pub fn rotate_content_key(
    app_data_dir: &Path,
    cloud_dir: &Path,
    passphrase: &str,
) -> Result<SyncCrypto> {
    let bytes = std::fs::read(chain_cache_path(app_data_dir))
        .context("read the cached key chain (unlock sync first)")?;
    let keys = ContentKeys::decode(&bytes)?;
    let (slots, _) = carried_slots(cloud_dir);
    let mut crypto = SyncCrypto::from_keys(keys, slots, true)?;
    crypto.rotate(passphrase.trim())?;
    persist_all(app_data_dir, &crypto)?;
    tracing::info!(
        "Sync content key rotated to v{}",
        crypto.keys().current_version()
    );
    Ok(crypto)
}

/// Whether an error from the engine means "key material missing or wrong"
/// (re-enter the ladder at the passphrase rung) rather than a plain I/O
/// failure. On such an error the caller drops the engine, clears the
/// proven-wrong cache, and latches `needs_unlock`.
pub fn is_key_material_error(err: &anyhow::Error) -> bool {
    matches!(
        err.downcast_ref::<SyncCryptoError>(),
        Some(SyncCryptoError::Auth) | Some(SyncCryptoError::UnknownKeyVersion(_))
    )
}

/// Latch the ladder at the passphrase rung and drop the proven-wrong cache.
pub fn enter_needs_unlock(app_data_dir: &Path) {
    let _ = std::fs::remove_file(chain_cache_path(app_data_dir));
    let mut settings = load_settings(app_data_dir);
    settings.needs_unlock = true;
    if let Err(err) = save_settings(app_data_dir, &settings) {
        tracing::warn!("Failed to persist the needs-unlock latch: {err:#}");
    }
}

/// Two-tier disable (ADR 04 §7): stop publishing (default — peers' sync
/// group untouched) versus delete my cloud data (destructive, separately
/// confirmed). Returns a human-readable summary of what was removed.
pub fn disable_sync(
    app_data_dir: &Path,
    cloud_dir: Option<&Path>,
    delete_cloud_data: bool,
) -> Result<String> {
    let mut settings = load_settings(app_data_dir);
    settings.enabled = false;
    save_settings(app_data_dir, &settings)?;
    if !delete_cloud_data {
        return Ok("Stopped publishing. Your other devices keep syncing.".into());
    }
    let Some(cloud_dir) = cloud_dir else {
        return Ok("Stopped publishing (no cloud container was present).".into());
    };
    let mut removed = 0usize;
    if let Err(err) = std::fs::remove_file(artifact_path(cloud_dir)) {
        if err.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!("Failed to remove the cloud snapshot: {err}");
        }
    } else {
        removed += 1;
    }
    let blobs = cloud_dir.join("blobs");
    if blobs.is_dir()
        && let Err(err) = std::fs::remove_dir_all(&blobs)
    {
        tracing::warn!("Failed to remove the cloud blob store: {err}");
    }
    // Local key material is void with the cloud data gone; a future
    // enablement bootstraps a fresh group.
    let _ = std::fs::remove_file(chain_cache_path(app_data_dir));
    let mut settings = load_settings(app_data_dir);
    settings.needs_unlock = false;
    save_settings(app_data_dir, &settings)?;
    Ok(format!(
        "Stopped publishing and deleted the cloud snapshot and blob store ({removed} snapshot file(s))."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn ladder_progresses_bootstrap_to_ready() {
        let dir = space();
        let cloud = dir.path().join("cloud");
        std::fs::create_dir_all(&cloud).unwrap();
        let settings = SyncSettings::default();

        // No artifact, no key: bootstrap.
        assert!(matches!(
            resolve_content_key(dir.path(), &cloud, &settings),
            CkResolution::NeedBootstrap
        ));

        // Bootstrap mints and persists; the cache rung resolves Ready.
        let crypto = bootstrap_group(dir.path(), "ladder test passphrase").unwrap();
        assert_eq!(crypto.keys().current_version(), 1);
        let settings = SyncSettings {
            enabled: true,
            onboarded: true,
            ..Default::default()
        };
        match resolve_content_key(dir.path(), &cloud, &settings) {
            CkResolution::Ready(resolved) => assert_eq!(resolved.keys(), crypto.keys()),
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn needs_unlock_latch_short_circuits_to_passphrase() {
        let dir = space();
        let cloud = dir.path().join("cloud");
        std::fs::create_dir_all(&cloud).unwrap();
        // Even with a valid cached chain, the latch wins: re-enter at the
        // passphrase rung, never an error loop.
        bootstrap_group(dir.path(), "latch test passphrase").unwrap();
        std::fs::write(artifact_path(&cloud), b"CHSNPENC fake artifact").unwrap();
        let settings = SyncSettings {
            needs_unlock: true,
            ..Default::default()
        };
        assert!(matches!(
            resolve_content_key(dir.path(), &cloud, &settings),
            CkResolution::NeedPassphrase
        ));
    }

    #[test]
    fn unlock_roundtrip_via_artifact() {
        let dir = space();
        let cloud = dir.path().join("cloud");
        std::fs::create_dir_all(&cloud).unwrap();

        // Write an encrypted artifact with a bootstrapped key (payload
        // contents are irrelevant to the ladder).
        let crypto = bootstrap_group(dir.path(), "unlock test passphrase").unwrap();
        let (header, salt) = crypto.build_header("1:ab", 1).unwrap();
        let payload = chatshell_agent_core::sync_crypto::encrypt_snapshot_payload(
            crypto.keys(),
            &salt,
            b"zstd-bytes",
        )
        .unwrap();
        std::fs::write(
            artifact_path(&cloud),
            chatshell_agent_core::sync_crypto::build_artifact(&header, &payload),
        )
        .unwrap();

        // Fresh device (empty data dir): artifact present, no key → banner.
        let fresh = space();
        std::fs::create_dir_all(fresh.path().join("cloud")).unwrap();
        std::fs::copy(
            artifact_path(&cloud),
            artifact_path(&fresh.path().join("cloud")),
        )
        .unwrap();
        assert!(matches!(
            resolve_content_key(
                fresh.path(),
                &fresh.path().join("cloud"),
                &SyncSettings::default()
            ),
            CkResolution::NeedPassphrase
        ));

        // Wrong passphrase fails; the right one recovers the exact chain.
        assert!(unlock_with_passphrase(fresh.path(), &fresh.path().join("cloud"), "nope").is_err());
        let unlocked = unlock_with_passphrase(
            fresh.path(),
            &fresh.path().join("cloud"),
            "unlock test passphrase",
        )
        .unwrap();
        assert_eq!(unlocked.keys(), crypto.keys());
        // needs_unlock latch cleared.
        assert!(!load_settings(fresh.path()).needs_unlock);
    }

    #[test]
    fn rotate_appends_version_and_old_keys_still_open_blobs() {
        let dir = space();
        let cloud = dir.path().join("cloud");
        std::fs::create_dir_all(&cloud).unwrap();
        let mut crypto = bootstrap_group(dir.path(), "rotate test passphrase").unwrap();
        let data = b"pre-rotation blob".to_vec();
        let digest = chatshell_agent_core::crypto::blake3_hex(&data);
        let sealed = crypto.encrypt_blob(&digest, &data).unwrap();

        let rotated = rotate_content_key(dir.path(), &cloud, "rotate test passphrase").unwrap();
        assert_eq!(rotated.keys().current_version(), 2);
        // Old blob still decrypts under the rotated chain.
        assert_eq!(rotated.decrypt_blob(&digest, &sealed).unwrap(), data);
        // Persisted chain carries both versions.
        let chain = std::fs::read(chain_cache_path(dir.path())).unwrap();
        assert_eq!(ContentKeys::decode(&chain).unwrap(), *rotated.keys());
    }

    #[test]
    fn disable_tiers() {
        let dir = space();
        let cloud = dir.path().join("cloud");
        std::fs::create_dir_all(cloud.join("blobs")).unwrap();
        std::fs::write(artifact_path(&cloud), b"artifact").unwrap();
        std::fs::write(cloud.join("blobs/abc"), b"blob").unwrap();
        bootstrap_group(dir.path(), "disable test passphrase").unwrap();

        // Stop-publish tier: cloud data untouched, chain retained.
        let msg = disable_sync(dir.path(), Some(&cloud), false).unwrap();
        assert!(msg.contains("keep syncing"));
        assert!(artifact_path(&cloud).exists());
        assert!(chain_cache_path(dir.path()).exists());
        assert!(!load_settings(dir.path()).enabled);

        // Delete tier: snapshot + blobs + chain gone.
        let msg = disable_sync(dir.path(), Some(&cloud), true).unwrap();
        assert!(msg.contains("deleted"));
        assert!(!artifact_path(&cloud).exists());
        assert!(!cloud.join("blobs").exists());
        assert!(!chain_cache_path(dir.path()).exists());
    }

    #[test]
    fn key_material_error_classification() {
        let key_err: anyhow::Error = SyncCryptoError::UnknownKeyVersion(7).into();
        assert!(is_key_material_error(&key_err));
        let auth_err: anyhow::Error = SyncCryptoError::Auth.into();
        assert!(is_key_material_error(&auth_err));
        let io_err: anyhow::Error = std::io::Error::other("boom").into();
        assert!(!is_key_material_error(&io_err));
    }
}
