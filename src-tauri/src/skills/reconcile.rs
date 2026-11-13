//! Reconcile skill directories on disk with the skill index.
//!
//! Three kinds of sources behave differently:
//!
//! - **Builtin** skills ship with the app. They are indexed (and their rows
//!   sync, so assistant links survive), but a missing builtin never deletes
//!   its row: a peer on an older build simply lacks it.
//! - **External** sources (other agents' skill directories) are indexed on
//!   this device only (core's merge withholds them), so a missing directory
//!   or a disabled source removes the local rows.
//! - **ChatShell's own** skills (`user`) are synced: the row carries the
//!   file manifest and the files travel as encrypted content-addressed blobs.
//!   A three-way comparison decides each skill, between the folder on disk
//!   (F), the row (R) and the hash this device last had in sync (L, kept in
//!   the device-local database):
//!
//!   | row        | folder  | decision                                       |
//!   |------------|---------|------------------------------------------------|
//!   | live       | F == R  | in sync                                        |
//!   | live       | F != R  | L == F: remote edit, fetch R; else local edit wins |
//!   | live       | missing | L known: deleted here, tombstone; else fetch R  |
//!   | tombstoned | present | F == L: deleted on a peer, trash folder; else revive |
//!   | none       | present | new local skill, index it                      |
//!
//! Folders ChatShell removes or replaces are moved to `.trash` below the
//! user root, never deleted outright.

use anyhow::{Context, Result};
use chatshell_agent_core::sync_crypto::{CK_LEN, SyncCryptoError};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::manifest::safe_join;
use super::roots::{SOURCE_BUILTIN, SOURCE_USER, SkillRoots};
use super::scanner::{DiscoveredSkill, ScanDirectory, SkillScanner};
use crate::db::Database;
use crate::models::Skill;

/// Encrypted blob store access for fetching synced skill files.
pub struct BlobAccess {
    pub cloud_dir: PathBuf,
    pub key: [u8; CK_LEN],
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReconcileReport {
    /// Whether the index or any skill folder changed.
    pub changed: bool,
    /// Synced skills whose files could not be materialized yet (blobs not
    /// uploaded by the authoring peer, or sync unavailable).
    pub pending_fetch: usize,
    /// A blob was undecodable under the current content key.
    pub needs_unlock: bool,
}

/// Serializes reconcile passes (Settings rescan, chat input, post-sync).
static RECONCILE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Index every scanned source and reconcile ChatShell's own skills.
/// `scan_dirs` lists the sources to scan (builtin, user, enabled external
/// sources); live rows of any other external source are removed.
pub async fn reconcile_skills(
    db: &Database,
    roots: &SkillRoots,
    scan_dirs: &[ScanDirectory],
    blobs: Option<&BlobAccess>,
) -> Result<ReconcileReport> {
    let _guard = RECONCILE_LOCK.lock().await;
    let discovered = SkillScanner::new(scan_dirs.to_vec()).scan_all().await?;
    let mut by_source: HashMap<&str, Vec<&DiscoveredSkill>> = HashMap::new();
    for skill in &discovered {
        by_source
            .entry(skill.source.as_str())
            .or_default()
            .push(skill);
    }

    let mut report = ReconcileReport::default();
    for dir in scan_dirs {
        let found = by_source.remove(dir.source.as_str()).unwrap_or_default();
        if dir.source == SOURCE_USER {
            reconcile_user(db, roots, &found, blobs, &mut report).await?;
        } else {
            index_source(db, &dir.source, &found, &mut report).await?;
        }
    }

    // External sources that were not scanned (disabled): drop their rows.
    let scanned: HashSet<&str> = scan_dirs.iter().map(|d| d.source.as_str()).collect();
    for skill in db.list_skills().await? {
        if skill.source != SOURCE_USER
            && skill.source != SOURCE_BUILTIN
            && !scanned.contains(skill.source.as_str())
        {
            db.delete_skill(&skill.id).await?;
            report.changed = true;
        }
    }

    Ok(report)
}

/// Builtin and external sources: index what is on disk.
async fn index_source(
    db: &Database,
    source: &str,
    found: &[&DiscoveredSkill],
    report: &mut ReconcileReport,
) -> Result<()> {
    let rows = db.list_skills_with_tombstones(source).await?;
    let mut seen: HashSet<String> = HashSet::new();
    for skill in found {
        let req = skill.to_create_request();
        // Declared ids (builtin) win so every device shares the row; other
        // sources match on the natural key.
        let existing = skill
            .id
            .as_deref()
            .and_then(|id| rows.iter().find(|(r, _)| r.id == id))
            .or_else(|| rows.iter().find(|(r, _)| r.name == skill.name));
        let result = match existing {
            Some((row, deleted)) => {
                seen.insert(row.id.clone());
                if *deleted {
                    db.revive_skill(&row.id, req).await.map(|_| true)
                } else if !row_matches(row, skill) {
                    let mut req = req;
                    // User toggles live on the row, not in the folder.
                    req.is_enabled = Some(row.is_enabled);
                    db.update_skill(&row.id, req).await.map(|_| true)
                } else {
                    Ok(false)
                }
            }
            None => db
                .create_skill_with_id(skill.id.as_deref(), req)
                .await
                .map(|row| {
                    seen.insert(row.id);
                    true
                }),
        };
        match result {
            Ok(changed) => report.changed |= changed,
            Err(err) => tracing::warn!(
                "⚠️ [skills] Failed to index '{}' ({source}): {err}",
                skill.name
            ),
        }
    }

    // A builtin missing from this build stays indexed (a peer may run a
    // newer build); external skills that vanished are dropped.
    if source != SOURCE_BUILTIN {
        for (row, deleted) in &rows {
            if !deleted && !seen.contains(&row.id) {
                tracing::info!("[skills] Removing stale skill '{}' ({source})", row.name);
                db.delete_skill(&row.id).await?;
                report.changed = true;
            }
        }
    }
    Ok(())
}

/// ChatShell's own skills: three-way reconcile (see module docs).
async fn reconcile_user(
    db: &Database,
    roots: &SkillRoots,
    found: &[&DiscoveredSkill],
    blobs: Option<&BlobAccess>,
    report: &mut ReconcileReport,
) -> Result<()> {
    let rows = db.list_skills_with_tombstones(SOURCE_USER).await?;
    let local = db.get_skill_local_hashes().await?;
    let folders: HashMap<&str, &DiscoveredSkill> =
        found.iter().map(|s| (s.path.as_str(), *s)).collect();

    // One row per directory: a live row beats tombstones; among tombstones
    // the most recent one.
    let mut by_path: HashMap<&str, &(Skill, bool)> = HashMap::new();
    for entry in &rows {
        let (row, deleted) = entry;
        match by_path.get(row.path.as_str()) {
            Some((current, current_deleted)) => {
                let better = (!deleted && *current_deleted)
                    || (*deleted == *current_deleted && row.updated_at > current.updated_at);
                if better {
                    by_path.insert(row.path.as_str(), entry);
                }
            }
            None => {
                by_path.insert(row.path.as_str(), entry);
            }
        }
    }

    for (path, (row, deleted)) in &by_path {
        let folder = folders.get(path).copied();
        let last = local.get(&row.id).map(String::as_str);
        let remote = row.content_hash.as_deref();
        match (*deleted, folder) {
            (false, Some(f)) => {
                let here = f.content_hash.as_str();
                if Some(here) == remote {
                    if !row_matches(row, f) {
                        // Same files, stale parse (e.g. a parser fix).
                        adopt_folder(db, row, false, f, report).await?;
                    } else if last != Some(here) {
                        db.set_skill_local_hash(&row.id, here).await?;
                    }
                } else if last == Some(here) {
                    // Untouched here since the last sync: a peer edited it.
                    materialize_or_defer(db, roots, row, blobs, report).await?;
                } else {
                    if last.is_some() && last != remote {
                        tracing::warn!(
                            "[skills] '{}' changed here and on another device; keeping this device's files",
                            row.name
                        );
                    }
                    adopt_folder(db, row, false, f, report).await?;
                }
            }
            (false, None) => {
                if last.is_some() {
                    tracing::info!(
                        "[skills] Skill folder '{}' was removed here; deleting the skill",
                        path
                    );
                    db.delete_skill(&row.id).await?;
                    db.clear_skill_local_hash(&row.id).await?;
                    report.changed = true;
                } else {
                    materialize_or_defer(db, roots, row, blobs, report).await?;
                }
            }
            (true, Some(f)) => {
                if last == Some(f.content_hash.as_str()) {
                    tracing::info!(
                        "[skills] '{}' was deleted on another device; moving its folder to trash",
                        row.name
                    );
                    move_to_trash(roots, &f.dir)?;
                    db.clear_skill_local_hash(&row.id).await?;
                    report.changed = true;
                } else {
                    // Edited (or re-created) after the delete: the edit wins.
                    adopt_folder(db, row, true, f, report).await?;
                }
            }
            (true, None) => {
                if last.is_some() {
                    db.clear_skill_local_hash(&row.id).await?;
                }
            }
        }
    }

    // Folders without a row: new local skills.
    for (path, folder) in &folders {
        if by_path.contains_key(path) {
            continue;
        }
        // The UNIQUE (name, source) key may be held by a row under another
        // directory: a tombstone or a row whose directory is gone is
        // adopted (renamed folder); a live row with its own folder is a
        // name clash.
        let twin = rows.iter().find(|(r, _)| r.name == folder.name);
        let result = match twin {
            Some((row, deleted)) if *deleted || !folders.contains_key(row.path.as_str()) => {
                adopt_folder(db, row, *deleted, folder, report).await
            }
            Some(_) => {
                tracing::warn!(
                    "⚠️ [skills] Skipping '{}': another skill folder already uses the name '{}'",
                    path,
                    folder.name
                );
                Ok(())
            }
            None => match db.create_skill(folder.to_create_request()).await {
                Ok(row) => {
                    db.set_skill_local_hash(&row.id, &folder.content_hash)
                        .await?;
                    report.changed = true;
                    Ok(())
                }
                Err(err) => Err(err),
            },
        };
        if let Err(err) = result {
            tracing::warn!("⚠️ [skills] Failed to index '{}': {err}", folder.name);
        }
    }
    Ok(())
}

/// Whether the row already reflects what was parsed from the folder.
/// Compares parsed metadata too, not only the content hash, so improving
/// the frontmatter parser refreshes rows whose files did not change.
fn row_matches(row: &Skill, skill: &DiscoveredSkill) -> bool {
    row.content_hash.as_deref() == Some(skill.content_hash.as_str())
        && row.path == skill.path
        && row.name == skill.name
        && row.description == skill.description
        && row.icon == skill.icon
        && row.required_tool_ids == skill.required_tool_ids
        && row.allow_model_invocation == skill.allow_model_invocation
        && row.allow_user_invocation == skill.allow_user_invocation
        && row.cached_instructions.as_deref() == Some(skill.instructions.as_str())
}

/// Write the folder's state into the row (local edit / new folder / revive).
async fn adopt_folder(
    db: &Database,
    row: &Skill,
    revive: bool,
    folder: &DiscoveredSkill,
    report: &mut ReconcileReport,
) -> Result<()> {
    let mut req = folder.to_create_request();
    // User toggles live on the row, not in the folder.
    req.is_enabled = Some(row.is_enabled || revive);
    if revive {
        db.revive_skill(&row.id, req).await?;
    } else {
        db.update_skill(&row.id, req).await?;
    }
    db.set_skill_local_hash(&row.id, &folder.content_hash)
        .await?;
    report.changed = true;
    Ok(())
}

async fn materialize_or_defer(
    db: &Database,
    roots: &SkillRoots,
    row: &Skill,
    blobs: Option<&BlobAccess>,
    report: &mut ReconcileReport,
) -> Result<()> {
    let (Some(blobs), Some(hash)) = (blobs, row.content_hash.as_deref()) else {
        report.pending_fetch += 1;
        return Ok(());
    };
    if row.files_manifest.is_empty() {
        // Written by a build that did not ship files yet.
        report.pending_fetch += 1;
        return Ok(());
    }
    let Some(target) = roots.skill_dir(SOURCE_USER, &row.path) else {
        tracing::warn!(
            "⚠️ [skills] '{}' has an unusable path {:?}",
            row.name,
            row.path
        );
        return Ok(());
    };
    let row = row.clone();
    let roots_owned = roots.clone();
    let cloud_dir = blobs.cloud_dir.clone();
    let key = blobs.key;
    let outcome = tokio::task::spawn_blocking(move || {
        materialize(&roots_owned, &target, &row, &cloud_dir, &key).map(|o| (o, row))
    })
    .await
    .context("materialize task")??;
    match outcome {
        (Materialized::Done, row) => {
            tracing::info!("[skills] Fetched '{}' from sync", row.name);
            db.set_skill_local_hash(&row.id, hash).await?;
            report.changed = true;
        }
        (Materialized::Missing, _) => report.pending_fetch += 1,
        (Materialized::Locked, _) => {
            report.pending_fetch += 1;
            report.needs_unlock = true;
        }
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum Materialized {
    Done,
    /// Some blob is not in the container yet.
    Missing,
    /// Some blob does not decrypt under the current key.
    Locked,
}

/// Write the row's files into `target` from the blob store: staged in a
/// sibling directory, then swapped in (the previous folder goes to trash).
fn materialize(
    roots: &SkillRoots,
    target: &Path,
    row: &Skill,
    cloud_dir: &Path,
    key: &[u8; CK_LEN],
) -> Result<Materialized> {
    let mut contents = Vec::with_capacity(row.files_manifest.len());
    for file in &row.files_manifest {
        let blob = cloud_dir.join(crate::blob_sync::BLOB_DIR).join(&file.hash);
        let Ok(sealed) = std::fs::read(&blob) else {
            return Ok(Materialized::Missing);
        };
        let bytes = match chatshell_agent_core::sync_crypto::decrypt_blob(key, &file.hash, &sealed)
        {
            Ok(bytes) => bytes,
            Err(SyncCryptoError::Corrupt(_)) => return Ok(Materialized::Locked),
            Err(err) => {
                tracing::warn!("Skill blob {} failed to decrypt: {err}", file.hash);
                return Ok(Materialized::Missing);
            }
        };
        if crate::storage::hash_bytes(&bytes) != file.hash {
            tracing::warn!("Skill blob {} does not match its digest", file.hash);
            return Ok(Materialized::Missing);
        }
        contents.push((file, bytes));
    }

    let parent = target.parent().context("skill dir has no parent")?;
    std::fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".incoming-{}", uuid::Uuid::now_v7()));
    let write = || -> Result<()> {
        for (file, bytes) in &contents {
            let dest = safe_join(&staging, &file.path)?;
            if let Some(dir) = dest.parent() {
                std::fs::create_dir_all(dir)?;
            }
            std::fs::write(&dest, bytes)?;
            #[cfg(unix)]
            if file.executable {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
            }
        }
        Ok(())
    };
    if let Err(err) = write() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(err);
    }
    if target.exists() {
        move_to_trash(roots, target)?;
    }
    std::fs::rename(&staging, target)
        .with_context(|| format!("install skill into {}", target.display()))?;
    Ok(Materialized::Done)
}

/// Move a skill folder into the trash under a unique name.
pub fn move_to_trash(roots: &SkillRoots, dir: &Path) -> Result<()> {
    let trash = roots.trash_dir();
    std::fs::create_dir_all(&trash)?;
    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("skill");
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
    // The tail of a v7 UUID is random; its head is the timestamp.
    let unique = uuid::Uuid::now_v7().simple().to_string();
    let dest = trash.join(format!("{name}-{stamp}-{}", &unique[unique.len() - 8..]));
    std::fs::rename(dir, &dest).with_context(|| format!("move {} to trash", dir.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chatshell_agent_core::sync::SyncEngine;
    use tempfile::TempDir;

    const KEY: [u8; CK_LEN] = [7u8; CK_LEN];

    /// One simulated device: its own database, home and skill roots, sharing
    /// a sync container with its peers.
    struct Device {
        db: Database,
        engine: SyncEngine,
        roots: SkillRoots,
        cloud: PathBuf,
        _dir: TempDir,
    }

    impl Device {
        async fn new(cloud: &Path) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let db_path = dir.path().join("data.db");
            let db = Database::new(db_path.to_str().unwrap()).await.unwrap();
            let engine = SyncEngine::new(
                &db_path,
                cloud.to_path_buf(),
                dir.path().join("stage"),
                None,
            )
            .unwrap();
            let roots = SkillRoots::new(
                dir.path().join("builtin"),
                Some(&dir.path().join("home")),
                &dir.path().join("appdata"),
            );
            std::fs::create_dir_all(&roots.user).unwrap();
            Self {
                db,
                engine,
                roots,
                cloud: cloud.to_path_buf(),
                _dir: dir,
            }
        }

        fn scan_dirs(&self) -> Vec<ScanDirectory> {
            let mut dirs = vec![
                ScanDirectory {
                    path: self.roots.builtin.clone(),
                    source: SOURCE_BUILTIN.into(),
                },
                ScanDirectory {
                    path: self.roots.user.clone(),
                    source: SOURCE_USER.into(),
                },
            ];
            for (source, root) in &self.roots.external {
                dirs.push(ScanDirectory {
                    path: root.clone(),
                    source: source.clone(),
                });
            }
            dirs
        }

        async fn reconcile(&self, with_blobs: bool) -> ReconcileReport {
            let blobs = BlobAccess {
                cloud_dir: self.cloud.clone(),
                key: KEY,
            };
            reconcile_skills(
                &self.db,
                &self.roots,
                &self.scan_dirs(),
                with_blobs.then_some(&blobs),
            )
            .await
            .unwrap()
        }

        /// Upload skill blobs, then publish/merge (blobs before snapshots).
        async fn sync(&mut self) {
            crate::blob_sync::ensure_skill_blobs_uploaded(&self.db, &self.cloud, &self.roots, &KEY)
                .await
                .unwrap();
            self.engine.sync_now_manual().unwrap();
        }

        fn user_dir(&self, name: &str) -> PathBuf {
            self.roots.user.join(name)
        }

        async fn user_skill(&self, name: &str) -> Option<Skill> {
            self.db
                .list_skills()
                .await
                .unwrap()
                .into_iter()
                .find(|s| s.source == SOURCE_USER && s.path == name)
        }
    }

    fn write(path: &Path, bytes: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn trash_entries(roots: &SkillRoots) -> usize {
        std::fs::read_dir(roots.trash_dir())
            .map(|d| d.count())
            .unwrap_or(0)
    }

    #[tokio::test]
    async fn chatshell_skills_travel_with_their_files() {
        let cloud = tempfile::tempdir().unwrap();
        let mut a = Device::new(cloud.path()).await;
        let mut b = Device::new(cloud.path()).await;

        write(
            &a.user_dir("notes").join("SKILL.md"),
            "---\nname: notes\ndescription: Take notes\n---\nWrite notes.",
        );
        write(
            &a.user_dir("notes").join("scripts/run.sh"),
            "#!/bin/sh\necho hi",
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                a.user_dir("notes").join("scripts/run.sh"),
                std::fs::Permissions::from_mode(0o755),
            )
            .unwrap();
        }
        // Another agent's skill on A: indexed there, never shipped.
        let claude_root = a.roots.root("claude").unwrap().to_path_buf();
        write(&claude_root.join("pdf/SKILL.md"), "# pdf");

        let report = a.reconcile(true).await;
        assert!(report.changed);
        let row = a.user_skill("notes").await.unwrap();
        assert_eq!(row.files_manifest.len(), 2);
        assert_eq!(a.db.list_skills().await.unwrap().len(), 2);

        a.sync().await;
        b.sync().await;

        // B knows the skill but has no files yet; without blob access the
        // row must survive (regression: B used to tombstone it for everyone).
        let report = b.reconcile(false).await;
        assert_eq!(report.pending_fetch, 1);
        assert!(b.user_skill("notes").await.is_some());
        assert!(!b.user_dir("notes").exists());

        // With blob access B materializes the whole directory.
        let report = b.reconcile(true).await;
        assert_eq!(report.pending_fetch, 0);
        assert!(report.changed);
        assert_eq!(
            std::fs::read_to_string(b.user_dir("notes").join("scripts/run.sh")).unwrap(),
            "#!/bin/sh\necho hi"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(b.user_dir("notes").join("scripts/run.sh"))
                .unwrap()
                .permissions()
                .mode();
            assert!(mode & 0o100 != 0, "executable bit survives: {mode:o}");
        }
        // The claude skill stayed on A.
        let b_sources: Vec<String> =
            b.db.list_skills()
                .await
                .unwrap()
                .into_iter()
                .map(|s| s.source)
                .collect();
        assert_eq!(b_sources, vec!["user".to_string()]);

        // A second pass on B is a no-op.
        assert_eq!(b.reconcile(true).await, ReconcileReport::default());
    }

    #[tokio::test]
    async fn edits_and_deletes_propagate_between_devices() {
        let cloud = tempfile::tempdir().unwrap();
        let mut a = Device::new(cloud.path()).await;
        let mut b = Device::new(cloud.path()).await;

        write(&a.user_dir("notes").join("SKILL.md"), "# v1");
        a.reconcile(true).await;
        a.sync().await;
        b.sync().await;
        b.reconcile(true).await;
        let id = b.user_skill("notes").await.unwrap().id;

        // B edits the skill; A picks the edit up and trashes its old copy.
        write(&b.user_dir("notes").join("SKILL.md"), "# v2");
        write(&b.user_dir("notes").join("ref.md"), "extra");
        assert!(b.reconcile(true).await.changed);
        b.sync().await;
        a.sync().await;
        assert!(a.reconcile(true).await.changed);
        assert_eq!(
            std::fs::read_to_string(a.user_dir("notes").join("SKILL.md")).unwrap(),
            "# v2"
        );
        assert!(a.user_dir("notes").join("ref.md").is_file());
        assert_eq!(trash_entries(&a.roots), 1);
        assert_eq!(a.user_skill("notes").await.unwrap().id, id);

        // A deletes the folder; the delete reaches B, whose copy is trashed.
        std::fs::remove_dir_all(a.user_dir("notes")).unwrap();
        assert!(a.reconcile(true).await.changed);
        assert!(a.user_skill("notes").await.is_none());
        a.sync().await;
        b.sync().await;
        assert!(b.reconcile(true).await.changed);
        assert!(!b.user_dir("notes").exists());
        assert_eq!(trash_entries(&b.roots), 1);
        assert!(b.user_skill("notes").await.is_none());
    }

    #[tokio::test]
    async fn stale_parsed_metadata_is_refreshed_without_file_changes() {
        let cloud = tempfile::tempdir().unwrap();
        let a = Device::new(cloud.path()).await;
        let claude_root = a.roots.root("claude").unwrap().to_path_buf();
        write(
            &claude_root.join("billing/SKILL.md"),
            "---\nname: billing\ndescription: |\n  Analyze costs.\n---\nBody",
        );
        a.reconcile(false).await;
        // Simulate a row indexed by an older parser that kept the "|".
        let row = a.db.list_skills().await.unwrap().remove(0);
        a.db.toggle_skill(&row.id).await.unwrap();
        sqlx::query("UPDATE skills SET description = '|' WHERE id = ?")
            .bind(&row.id)
            .execute(a.db.pool())
            .await
            .unwrap();

        assert!(a.reconcile(false).await.changed);
        let row = a.db.get_skill(&row.id).await.unwrap().unwrap();
        assert_eq!(row.description.as_deref(), Some("Analyze costs."));
        assert!(!row.is_enabled, "a refresh keeps the user's toggle");
        assert!(!a.reconcile(false).await.changed);
    }

    #[tokio::test]
    async fn recreated_skill_revives_its_tombstone() {
        let cloud = tempfile::tempdir().unwrap();
        let a = Device::new(cloud.path()).await;
        write(&a.user_dir("notes").join("SKILL.md"), "# v1");
        a.reconcile(false).await;
        let id = a.user_skill("notes").await.unwrap().id;
        std::fs::remove_dir_all(a.user_dir("notes")).unwrap();
        a.reconcile(false).await;
        assert!(a.user_skill("notes").await.is_none());

        // Same name again: UNIQUE (name, source) is held by the tombstone.
        write(&a.user_dir("notes").join("SKILL.md"), "# again");
        assert!(a.reconcile(false).await.changed);
        assert_eq!(a.user_skill("notes").await.unwrap().id, id);
    }

    #[tokio::test]
    async fn external_and_builtin_rows_follow_their_own_rules() {
        let cloud = tempfile::tempdir().unwrap();
        let a = Device::new(cloud.path()).await;
        let builtin_id = "019a0000-0000-7000-8000-000000000001";
        write(
            &a.roots.builtin.join("installer/SKILL.md"),
            &format!("---\nname: installer\nmetadata:\n  id: {builtin_id}\n---\nInstall."),
        );
        let claude_root = a.roots.root("claude").unwrap().to_path_buf();
        write(&claude_root.join("pdf/SKILL.md"), "# pdf");
        write(&claude_root.join(".hidden/SKILL.md"), "# never a skill");
        a.reconcile(false).await;

        let skills = a.db.list_skills().await.unwrap();
        let builtin = skills.iter().find(|s| s.source == "builtin").unwrap();
        assert_eq!(builtin.id, builtin_id, "declared builtin ids are shared");
        assert!(
            builtin.files_manifest.is_empty(),
            "builtin files never ship"
        );
        assert_eq!(skills.iter().filter(|s| s.source == "claude").count(), 1);

        // A missing builtin keeps its row; a missing external skill goes.
        std::fs::remove_dir_all(a.roots.builtin.join("installer")).unwrap();
        std::fs::remove_dir_all(claude_root.join("pdf")).unwrap();
        a.reconcile(false).await;
        let sources: Vec<String> =
            a.db.list_skills()
                .await
                .unwrap()
                .into_iter()
                .map(|s| s.source)
                .collect();
        assert_eq!(sources, vec!["builtin".to_string()]);

        // An external skill that comes back revives its row.
        write(&claude_root.join("pdf/SKILL.md"), "# pdf again");
        assert!(a.reconcile(false).await.changed);
        assert!(
            a.db.list_skills()
                .await
                .unwrap()
                .iter()
                .any(|s| s.source == "claude")
        );
    }
}
