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
use chatshell_agent_core::sync_crypto::{SyncCrypto, SyncCryptoError};
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
    /// Last failed sync pass (auto or manual), surfaced in Settings as the
    /// trigger for the escape hatches (Sync now / Force publish /
    /// passphrase unlock). Cleared by the next successful pass.
    pub last_pass_error: Option<String>,
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

/// Run the graded acquisition ladder (ADR 04 §3 rule 2). When
/// `settings.needs_unlock` is set (artifact failed to unwrap under held
/// keys), the ladder re-enters directly at the passphrase rung.
pub fn resolve_content_key(
    app_data_dir: &Path,
    cloud_dir: &Path,
    settings: &SyncSettings,
) -> CkResolution {
    resolve_content_key_with_item(
        app_data_dir,
        cloud_dir,
        settings,
        keychain_content_key().as_deref(),
    )
}

/// Ladder core with the synchronizable-item value injected (tests).
fn resolve_content_key_with_item(
    app_data_dir: &Path,
    cloud_dir: &Path,
    settings: &SyncSettings,
    keychain_item: Option<&str>,
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

    // Rung 1: iCloud Keychain synchronizable item (Apple platforms). The
    // item carries the CK (`v1:<b64>`); adoption is format-gated — legacy
    // bare-base64 and rotation-era versions never parse. A stale-but-v1
    // item (key from a dead group) installs a wrong-key engine whose first
    // pull fails Auth and re-enters this ladder at the passphrase rung.
    if let Some(ck) =
        keychain_item.and_then(chatshell_agent_core::sync_crypto::parse_synchronizable_item)
    {
        let mut crypto = match SyncCrypto::from_keys(ck, None, true) {
            Ok(crypto) => crypto,
            Err(_) => return CkResolution::NeedPassphrase,
        };
        adopt_remote_slot(&mut crypto, cloud_dir);
        return CkResolution::Ready(crypto);
    }

    // Rung 2: locally cached full state (CK AND wrapped slot — the
    // bootstrap device needs its slot to publish the FIRST artifact, when
    // no artifact exists to adopt one from; real-device finding
    // 2026-08-27). A cache holding the wrong key fails the same Auth path
    // as rung 1 and re-enters at the passphrase rung.
    if let Ok(bytes) = std::fs::read(chain_cache_path(app_data_dir))
        && let Ok(mut crypto) = SyncCrypto::decode_state(&bytes)
    {
        adopt_remote_slot(&mut crypto, cloud_dir);
        return CkResolution::Ready(crypto);
    }

    // Rung 3 is time: the sync tick re-runs this ladder silently (backoff),
    // because Keychain propagation delay is normal. Rung 4 is the banner.
    if has_artifact {
        CkResolution::NeedPassphrase
    } else {
        CkResolution::NeedBootstrap
    }
}

/// Adopt the wrapped slot from the live artifact's header, when one exists
/// and this state holds no slot yet. Slots are public ciphertext: every
/// publish carries them forward so passphrase-only peers keep their
/// fallback (ADR 04 §4).
fn adopt_remote_slot(crypto: &mut SyncCrypto, cloud_dir: &Path) {
    if let Ok(header) =
        chatshell_agent_core::sync_crypto::read_artifact_header(&artifact_path(cloud_dir))
    {
        crypto.adopt_slot_from(&header);
    }
}

/// Persist the full crypto state (keys AND wrapped slots) into the
/// device-local cache. The file sits beside the plaintext local DB by
/// design (ADR 04 §2): the neighboring database is already plaintext, so
/// the cache adds no local exposure — the CK exists solely to protect the
/// cloud copy. Slots ride along because the bootstrapping first device
/// must publish the FIRST artifact before any artifact exists to carry
/// them (real-device finding 2026-08-27).
pub fn persist_chain(app_data_dir: &Path, crypto: &SyncCrypto) -> Result<()> {
    let path = chain_cache_path(app_data_dir);
    std::fs::write(&path, crypto.encode_state())
        .with_context(|| format!("write {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Persist with a PROVEN current key and overwrite the item. Two callers
/// only, both with positive proof the key is the live group's:
/// - **bootstrap** mints a fresh group; the artifact-existence guard means
///   no live group competes, so any existing item is an orphan from a dead
///   group (real-device finding: a stale orphaned item otherwise blocks
///   the minted key from ever reaching iCloud Keychain, and every later
///   device degrades to the passphrase rung).
/// - **unlock** decrypted the live artifact with this key seconds ago;
///   this repairs an item whose bootstrap-time write failed.
fn persist_all_proven(app_data_dir: &Path, crypto: &SyncCrypto) -> Result<()> {
    persist_chain(app_data_dir, crypto)?;
    publish_keychain_content_key(&crypto.synchronizable_item_value());
    Ok(())
}

/// First device of a sync group: mint a CK and wrap it under the group
/// passphrase. Bootstrap requires the passphrase even on Apple (ADR 04 §3
/// rule 1) — otherwise the fallback does not exist when the Keychain slot
/// fails.
pub fn bootstrap_group(app_data_dir: &Path, passphrase: &str) -> Result<SyncCrypto> {
    let crypto = SyncCrypto::bootstrap(passphrase.trim())?;
    persist_all_proven(app_data_dir, &crypto)?;
    tracing::info!("Sync group bootstrapped (content key v1)");
    Ok(crypto)
}

/// Passphrase rung: unwrap the remote artifact's single slot into the CK,
/// then persist both stores and clear the needs-unlock latch.
pub fn unlock_with_passphrase(
    app_data_dir: &Path,
    cloud_dir: &Path,
    passphrase: &str,
) -> Result<SyncCrypto> {
    let header = chatshell_agent_core::sync_crypto::read_artifact_header(&artifact_path(cloud_dir))
        .map_err(anyhow::Error::new)
        .context("read the cloud artifact header")?;
    let crypto = SyncCrypto::from_passphrase(&header, passphrase.trim(), true)?;
    persist_all_proven(app_data_dir, &crypto)?;
    let mut settings = load_settings(app_data_dir);
    settings.needs_unlock = false;
    save_settings(app_data_dir, &settings)?;
    tracing::info!("Sync content key unlocked via passphrase");
    Ok(crypto)
}

/// Record a failed sync pass so Settings can surface it (auto-sync failure
/// detection — the escape hatches exist because sync can wedge silently).
pub fn record_pass_error(app_data_dir: &Path, error: &str) {
    let mut settings = load_settings(app_data_dir);
    settings.last_pass_error = Some(error.chars().take(300).collect());
    if let Err(err) = save_settings(app_data_dir, &settings) {
        tracing::warn!("Failed to record sync pass error: {err}");
    }
}

/// Clear the failure latch after a successful pass.
pub fn clear_pass_error(app_data_dir: &Path) {
    let mut settings = load_settings(app_data_dir);
    if settings.last_pass_error.take().is_some() {
        if let Err(err) = save_settings(app_data_dir, &settings) {
            tracing::warn!("Failed to clear sync pass error: {err}");
        }
    }
}

/// Whether an error from the engine means "key material missing or wrong"
/// (re-enter the ladder at the passphrase rung) rather than a plain I/O
/// failure. On such an error the caller drops the engine, clears the
/// proven-wrong cache, and latches `needs_unlock`.
pub fn is_key_material_error(err: &anyhow::Error) -> bool {
    matches!(
        err.downcast_ref::<SyncCryptoError>(),
        Some(SyncCryptoError::Auth)
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
        let settings = SyncSettings {
            enabled: true,
            onboarded: true,
            ..Default::default()
        };
        match resolve_content_key(dir.path(), &cloud, &settings) {
            CkResolution::Ready(resolved) => {
                assert_eq!(resolved.current_key(), crypto.current_key())
            }
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
            crypto.current_key(),
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
        assert_eq!(unlocked.current_key(), crypto.current_key());
        // needs_unlock latch cleared.
        assert!(!load_settings(fresh.path()).needs_unlock);
    }

    /// Publish an artifact under `crypto`'s current key so the ladder can
    /// see a real header (payload contents are irrelevant to rung 1).
    fn publish_test_artifact(crypto: &SyncCrypto, cloud: &Path) {
        let (header, salt) = crypto.build_header("1:test", 1).unwrap();
        let payload = chatshell_agent_core::sync_crypto::encrypt_snapshot_payload(
            crypto.current_key(),
            &salt,
            b"test payload",
        )
        .unwrap();
        std::fs::write(
            artifact_path(cloud),
            chatshell_agent_core::sync_crypto::build_artifact(&header, &payload),
        )
        .unwrap();
    }

    #[test]
    fn rung1_adopts_item_and_rejects_legacy_values() {
        let dir = space();
        let cloud = dir.path().join("cloud");
        std::fs::create_dir_all(&cloud).unwrap();
        let crypto = bootstrap_group(dir.path(), "versioned item passphrase").unwrap();
        publish_test_artifact(&crypto, &cloud);
        let item = crypto.synchronizable_item_value();
        let settings = SyncSettings {
            enabled: true,
            onboarded: true,
            ..Default::default()
        };
        // No cached chain on this device: the item alone must resolve.
        std::fs::remove_file(chain_cache_path(dir.path())).unwrap();
        match resolve_content_key_with_item(dir.path(), &cloud, &settings, Some(item.as_str())) {
            CkResolution::Ready(resolved) => {
                assert_eq!(resolved.current_key(), crypto.current_key())
            }
            other => panic!("expected Ready, got {other:?}"),
        }
        // A legacy bare-base64 item must not adopt (the `v1:` prefix is
        // the format marker).
        use base64::{Engine as _, engine::general_purpose};
        let legacy = general_purpose::STANDARD.encode(crypto.current_key());
        assert!(matches!(
            resolve_content_key_with_item(dir.path(), &cloud, &settings, Some(legacy.as_str())),
            CkResolution::NeedPassphrase
        ));
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
        let auth_err: anyhow::Error = SyncCryptoError::Auth.into();
        assert!(is_key_material_error(&auth_err));
        let corrupt_err: anyhow::Error = SyncCryptoError::Corrupt("legacy".into()).into();
        assert!(!is_key_material_error(&corrupt_err));
        let io_err: anyhow::Error = std::io::Error::other("boom").into();
        assert!(!is_key_material_error(&io_err));
    }
}
