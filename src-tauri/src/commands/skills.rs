use super::AppState;
use crate::models::{CreateSkillRequest, Skill};
use crate::skills::{
    BlobAccess, EXTERNAL_SKILL_SOURCES, ReconcileReport, SOURCE_BUILTIN, SOURCE_USER,
    ScanDirectory, SkillRoots,
};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use ts_rs::TS;

#[tauri::command]
pub async fn list_skills(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<Skill>, String> {
    let roots = SkillRoots::from_app(&app)?;
    let skills = state.db.list_skills().await.map_err(|e| e.to_string())?;
    Ok(with_local_paths(skills, &roots))
}

#[tauri::command]
pub async fn get_skill(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<Skill>, String> {
    let roots = SkillRoots::from_app(&app)?;
    let skill = state.db.get_skill(&id).await.map_err(|e| e.to_string())?;
    Ok(skill.map(|s| with_local_path(s, &roots)))
}

/// Fill `local_path` for skills whose files are present on this device.
pub fn with_local_paths(skills: Vec<Skill>, roots: &SkillRoots) -> Vec<Skill> {
    skills
        .into_iter()
        .map(|s| with_local_path(s, roots))
        .collect()
}

pub fn with_local_path(mut skill: Skill, roots: &SkillRoots) -> Skill {
    skill.local_path = roots
        .local_skill_md(&skill.source, &skill.path)
        .and_then(|md| md.parent().map(|d| d.to_string_lossy().to_string()));
    skill
}

#[tauri::command]
pub async fn create_skill(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    req: CreateSkillRequest,
) -> Result<Skill, String> {
    let roots = SkillRoots::from_app(&app)?;
    let skill = state
        .db
        .create_skill(req)
        .await
        .map_err(|e| e.to_string())?;
    Ok(with_local_path(skill, &roots))
}

#[tauri::command]
pub async fn update_skill(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    req: CreateSkillRequest,
) -> Result<Skill, String> {
    let roots = SkillRoots::from_app(&app)?;
    let skill = state
        .db
        .update_skill(&id, req)
        .await
        .map_err(|e| e.to_string())?;
    Ok(with_local_path(skill, &roots))
}

/// Delete one of ChatShell's own skills: its folder moves to the skills
/// trash (in the app data directory) and the tombstone syncs, so peers
/// trash their copy too. Builtin and external skills are not ChatShell's
/// to delete (disable them, or remove them in their own directory).
#[tauri::command]
pub async fn delete_skill(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let skill = state
        .db
        .get_skill(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Skill not found".to_string())?;
    if skill.source != SOURCE_USER {
        return Err(format!(
            "Skills from the '{}' source cannot be deleted from ChatShell",
            skill.source
        ));
    }
    let roots = SkillRoots::from_app(&app)?;
    if let Some(dir) = roots.skill_dir(SOURCE_USER, &skill.path)
        && dir.exists()
    {
        crate::skills::move_to_trash(&roots, &dir).map_err(|e| e.to_string())?;
    }
    state
        .db
        .delete_skill(&id)
        .await
        .map_err(|e| e.to_string())?;
    state
        .db
        .clear_skill_local_hash(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_skill(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<Skill, String> {
    let roots = SkillRoots::from_app(&app)?;
    let skill = state
        .db
        .toggle_skill(&id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(with_local_path(skill, &roots))
}

#[tauri::command]
pub async fn set_all_skills_enabled(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<Vec<Skill>, String> {
    let roots = SkillRoots::from_app(&app)?;
    let skills = state
        .db
        .set_all_skills_enabled(enabled)
        .await
        .map_err(|e| e.to_string())?;
    Ok(with_local_paths(skills, &roots))
}

#[tauri::command]
pub async fn set_skills_enabled(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    ids: Vec<String>,
    enabled: bool,
) -> Result<Vec<Skill>, String> {
    let roots = SkillRoots::from_app(&app)?;
    let skills = state
        .db
        .set_skills_enabled(&ids, enabled)
        .await
        .map_err(|e| e.to_string())?;
    Ok(with_local_paths(skills, &roots))
}

/// Info about a skill source directory shown in the UI
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SkillSourceInfo {
    pub source: String,
    pub path: String,
    pub enabled: bool,
    pub always_on: bool,
    pub exists: bool,
    /// Whether skills of this source sync across devices.
    pub synced: bool,
}

async fn source_enabled(state: &AppState, setting_key: &str) -> bool {
    state
        .db
        .get_setting(setting_key)
        .await
        .ok()
        .flatten()
        .map(|v| v != "false")
        .unwrap_or(true)
}

/// Return metadata about all skill source directories
#[tauri::command]
pub async fn get_skill_sources(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<SkillSourceInfo>, String> {
    let roots = SkillRoots::from_app(&app)?;
    let mut sources = vec![SkillSourceInfo {
        source: SOURCE_USER.to_string(),
        path: roots.user.to_string_lossy().to_string(),
        enabled: true,
        always_on: true,
        exists: roots.user.exists(),
        synced: true,
    }];
    for (source, _, setting_key) in EXTERNAL_SKILL_SOURCES {
        let Some(dir) = roots.root(source) else {
            continue;
        };
        sources.push(SkillSourceInfo {
            source: source.to_string(),
            path: dir.to_string_lossy().to_string(),
            enabled: source_enabled(&state, setting_key).await,
            always_on: false,
            exists: dir.exists(),
            synced: false,
        });
    }
    Ok(sources)
}

/// Toggle an external skill source on or off
#[tauri::command]
pub async fn set_skill_source_enabled(
    state: State<'_, AppState>,
    source: String,
    enabled: bool,
) -> Result<(), String> {
    let setting_key = EXTERNAL_SKILL_SOURCES
        .iter()
        .find(|(s, _, _)| *s == source)
        .map(|(_, _, key)| *key)
        .ok_or_else(|| format!("Unknown skill source: {}", source))?;

    state
        .db
        .set_setting(setting_key, if enabled { "true" } else { "false" })
        .await
        .map_err(|e| e.to_string())
}

/// Directories to scan: builtin, ChatShell's own, and enabled external ones.
async fn build_scan_directories(state: &AppState, roots: &SkillRoots) -> Vec<ScanDirectory> {
    if let Err(e) = std::fs::create_dir_all(&roots.user) {
        tracing::warn!("⚠️ [scan_skills] Failed to create user skills dir: {}", e);
    }
    let mut dirs = vec![
        ScanDirectory {
            path: roots.builtin.clone(),
            source: SOURCE_BUILTIN.to_string(),
        },
        ScanDirectory {
            path: roots.user.clone(),
            source: SOURCE_USER.to_string(),
        },
    ];
    for (source, _, setting_key) in EXTERNAL_SKILL_SOURCES {
        if let Some(root) = roots.root(source)
            && source_enabled(state, setting_key).await
        {
            dirs.push(ScanDirectory {
                path: root.to_path_buf(),
                source: source.to_string(),
            });
        }
    }
    dirs
}

/// Reconcile skill folders with the index (and fetch synced skills when the
/// sync engine is ready). Shared by the scan command and the sync pass.
pub async fn run_skill_reconcile(
    state: &AppState,
    app: &tauri::AppHandle,
) -> Result<ReconcileReport, String> {
    let roots = SkillRoots::from_app(app)?;
    let dirs = build_scan_directories(state, &roots).await;
    let blobs = crate::sync::blob_access(&state.sync_engine)
        .map(|(cloud_dir, key)| BlobAccess { cloud_dir, key });
    let report = crate::skills::reconcile_skills(&state.db, &roots, &dirs, blobs.as_ref())
        .await
        .map_err(|e| e.to_string())?;
    if report.needs_unlock
        && let Ok(app_data_dir) = app.path().app_data_dir()
    {
        crate::sync_crypto_state::enter_needs_unlock(&app_data_dir);
        use tauri::Emitter;
        if let Err(err) = app.emit("sync-locked", ()) {
            tracing::warn!("Failed to emit sync-locked: {err}");
        }
    }
    Ok(report)
}

/// Scan the filesystem for skills and reconcile them with the index
#[tauri::command]
pub async fn scan_skills(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<Skill>, String> {
    run_skill_reconcile(&state, &app).await?;
    let roots = SkillRoots::from_app(&app)?;
    let skills = state.db.list_skills().await.map_err(|e| e.to_string())?;
    Ok(with_local_paths(skills, &roots))
}

/// Open a skill source directory in the system file manager
#[tauri::command]
pub async fn open_skills_directory(app: tauri::AppHandle, source: String) -> Result<(), String> {
    let roots = SkillRoots::from_app(&app)?;
    let dir = match source.as_str() {
        SOURCE_BUILTIN => return Err("Builtin skills ship inside the app".to_string()),
        other => roots
            .root(other)
            .map(|d| d.to_path_buf())
            .ok_or_else(|| format!("Unknown skill source: {}", other))?,
    };

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create skills directory: {}", e))?;

    tauri_plugin_opener::open_path(dir, None::<&str>)
        .map_err(|e| format!("Failed to open skills directory: {}", e))
}

/// Reveal one skill's folder in the system file manager
#[tauri::command]
pub async fn open_skill_folder(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let skill = state
        .db
        .get_skill(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Skill not found".to_string())?;
    let roots = SkillRoots::from_app(&app)?;
    let dir = roots
        .local_skill_md(&skill.source, &skill.path)
        .and_then(|md| md.parent().map(|d| d.to_path_buf()))
        .ok_or_else(|| "This skill's files are not on this device yet".to_string())?;
    tauri_plugin_opener::open_path(dir, None::<&str>)
        .map_err(|e| format!("Failed to open skill folder: {}", e))
}

/// Read a skill's SKILL.md on this device
#[tauri::command]
pub async fn read_skill_content(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<String, String> {
    let skill = state
        .db
        .get_skill(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Skill not found".to_string())?;
    let roots = SkillRoots::from_app(&app)?;
    match roots.local_skill_md(&skill.source, &skill.path) {
        Some(md) => tokio::fs::read_to_string(&md)
            .await
            .map_err(|e| format!("Failed to read SKILL.md: {}", e)),
        None => Err("This skill's files are not on this device yet".to_string()),
    }
}

/// Create one of ChatShell's own skills: a new folder with a SKILL.md.
#[tauri::command]
pub async fn create_user_skill(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    dir_name: String,
    content: String,
) -> Result<Skill, String> {
    let dir_name = dir_name.trim().to_string();
    let roots = SkillRoots::from_app(&app)?;
    let dir = roots
        .skill_dir(SOURCE_USER, &dir_name)
        .ok_or_else(|| format!("Invalid skill folder name: {dir_name:?}"))?;
    if dir.exists() {
        return Err(format!("A skill folder named '{dir_name}' already exists"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create skill folder: {e}"))?;
    std::fs::write(dir.join("SKILL.md"), content)
        .map_err(|e| format!("Failed to write SKILL.md: {e}"))?;
    run_skill_reconcile(&state, &app).await?;
    let skills = state.db.list_skills().await.map_err(|e| e.to_string())?;
    skills
        .into_iter()
        .find(|s| s.source == SOURCE_USER && s.path == dir_name)
        .map(|s| with_local_path(s, &roots))
        .ok_or_else(|| {
            "The skill was created but could not be indexed (is its name already used?)".to_string()
        })
}

/// Replace the SKILL.md of one of ChatShell's own skills.
#[tauri::command]
pub async fn save_skill_content(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    content: String,
) -> Result<Skill, String> {
    let skill = state
        .db
        .get_skill(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Skill not found".to_string())?;
    if skill.source != SOURCE_USER {
        return Err("Only ChatShell's own skills can be edited here".to_string());
    }
    let roots = SkillRoots::from_app(&app)?;
    let md = roots
        .local_skill_md(SOURCE_USER, &skill.path)
        .ok_or_else(|| "This skill's files are not on this device yet".to_string())?;
    let tmp = md.with_extension("md.tmp");
    std::fs::write(&tmp, content)
        .and_then(|_| std::fs::rename(&tmp, &md))
        .map_err(|e| format!("Failed to write SKILL.md: {e}"))?;
    run_skill_reconcile(&state, &app).await?;
    state
        .db
        .get_skill(&id)
        .await
        .map_err(|e| e.to_string())?
        .map(|s| with_local_path(s, &roots))
        .ok_or_else(|| "Skill not found after saving".to_string())
}
