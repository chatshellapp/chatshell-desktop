//! macOS-only: write the master encryption key to iCloud Keychain with
//! `kSecAttrSynchronizable = true` so it propagates to all devices under
//! the same Apple ID. The iOS peer reads the same keychain item to decrypt
//! `providers.api_key` values after merging the snapshot.
//!
//! The item lives in the shared, team-prefixed `app.chatshell.sync` access
//! group so the desktop (app.chatshell.desktop) and iOS (app.chatshell.ios)
//! apps can both see the SAME item; without an explicit group each app's
//! item would land in its own app-identifier group and never be shared.
//! Writing an access-group item requires the `keychain-access-groups`
//! entitlement granted by the development provisioning profile (Option A,
//! synchronizable-keychain-macos26-blocker.md).
//!
//! The team prefix is injected at BUILD time from `CHATSHELL_TEAM_ID`
//! (scripts/team-id.sh; GitHub CI passes a repository secret) — the Team ID
//! is deliberately not stored in this repo. Without it the item cannot be
//! shared, so the write/read paths degrade to a logged no-op instead of
//! silently using a wrong group.

use anyhow::{Context, Result};
use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use security_framework::passwords::{self, PasswordOptions};
use security_framework_sys::item::kSecAttrAccessGroup;

const SERVICE: &str = "app.chatshell.sync";
const ACCOUNT: &str = "master_encryption_key";
/// Account of the content-key (CK) item — a dedicated synchronizable item
/// separate from the master key's (ADR 04 §3: the CK lives in its own item
/// so the two failure radii stay independent).
pub const CONTENT_KEY_ACCOUNT: &str = "content_key";
/// Suffix of the shared keychain group; the full identifier is
/// `<team>.app.chatshell.sync`, identical on iOS (`ProviderKeySync`).
const SYNC_ACCESS_GROUP_SUFFIX: &str = "app.chatshell.sync";

/// Full shared access group, or None when the build lacked the team
/// injection (`CHATSHELL_TEAM_ID` unset at compile time).
fn sync_access_group() -> Option<String> {
    option_env!("CHATSHELL_TEAM_ID").map(|team| format!("{team}.{SYNC_ACCESS_GROUP_SUFFIX}"))
}

fn shared_group_options_for(account: &str) -> Option<PasswordOptions> {
    let group = sync_access_group()?;
    let mut options = PasswordOptions::new_generic_password(SERVICE, account);
    options.set_access_synchronized(Some(true));
    // security-framework's PasswordOptions has no access-group builder; the
    // query vec is public-but-deprecated, so push the attribute directly.
    let key = unsafe { CFString::wrap_under_get_rule(kSecAttrAccessGroup) };
    #[allow(deprecated)]
    options.query.push((key, CFString::new(&group).as_CFType()));
    Some(options)
}

fn shared_group_options() -> Option<PasswordOptions> {
    shared_group_options_for(ACCOUNT)
}

fn content_key_options() -> Option<PasswordOptions> {
    shared_group_options_for(CONTENT_KEY_ACCOUNT)
}

/// Write a base64 value to the iCloud-synchronizable content-key item.
/// Idempotent. No-ops (logged) when the build lacked the team injection.
pub fn set_synchronizable_content_key(value_b64: &str) -> Result<()> {
    let Some(options) = content_key_options() else {
        tracing::warn!(
            "CHATSHELL_TEAM_ID missing at build time — skipping the \
             synchronizable content key write"
        );
        return Ok(());
    };
    passwords::set_generic_password_options(value_b64.as_bytes(), options)
        .context("set synchronizable content key in keychain")?;
    Ok(())
}

/// Read the content key from its synchronizable item, if present and
/// readable. Errors degrade to `None` — an invisible transport item is a
/// ladder miss, not a failure.
pub fn get_synchronizable_content_key() -> Option<String> {
    let options = content_key_options()?;
    match passwords::generic_password(options) {
        Ok(data) => String::from_utf8(data).ok().filter(|v| !v.is_empty()),
        Err(_) => None,
    }
}

/// Write the base64-encoded master key to the iCloud-synchronizable keychain.
/// Idempotent — updates in place if already present. No-ops (logged) when
/// the build did not carry the team injection.
pub fn set_synchronizable_master_key(master_key_b64: &str) -> Result<()> {
    let Some(options) = shared_group_options() else {
        tracing::warn!(
            "🔐 [sync-keychain] CHATSHELL_TEAM_ID missing at build time — \
             skipping the synchronizable master key write"
        );
        return Ok(());
    };

    passwords::set_generic_password_options(master_key_b64.as_bytes(), options)
        .context("set synchronizable master key in keychain")?;

    tracing::info!("🔐 [sync-keychain] Master key stored in iCloud-synchronizable Keychain");
    Ok(())
}

/// Read the master key from the iCloud-synchronizable keychain, if present.
/// Errors (missing entitlement, unreadable item) degrade to `None` — the
/// caller treats an invisible transport as "local key stands".
pub fn get_synchronizable_master_key() -> Result<Option<String>> {
    let Some(options) = shared_group_options() else {
        return Ok(None);
    };

    match passwords::generic_password(options) {
        Ok(data) => {
            let value = String::from_utf8(data).context("decode master key from keychain")?;
            if value.is_empty() {
                Ok(None)
            } else {
                Ok(Some(value))
            }
        }
        Err(_) => Ok(None),
    }
}
