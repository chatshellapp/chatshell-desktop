use super::AppState;
use crate::models::{CreateSkillRequest, Skill};
use crate::skills::{ScanDirectory, SkillScanner};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

#[tauri::command]
pub async fn list_skills(state: State<'_, AppState>) -> Result<Vec<Skill>, String> {
    state.db.list_skills().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_skill(state: State<'_, AppState>, id: String) -> Result<Option<Skill>, String> {
    state.db.get_skill(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_skill(
    state: State<'_, AppState>,
    req: CreateSkillRequest,
) -> Result<Skill, String> {
    state.db.create_skill(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_skill(
    state: State<'_, AppState>,
    id: String,
    req: CreateSkillRequest,
) -> Result<Skill, String> {
    state
        .db
        .update_skill(&id, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_skill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_skill(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_skill(state: State<'_, AppState>, id: String) -> Result<Skill, String> {
    state.db.toggle_skill(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_all_skills_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<Vec<Skill>, String> {
    state
        .db
        .set_all_skills_enabled(enabled)
        .await
        .map_err(|e| e.to_string())
}

/// Well-known external skill directories (beyond ~/.chatshell/skills)
const EXTERNAL_SKILL_SOURCES: &[(&str, &str, &str)] = &[
    ("claude", ".claude/skills", "skill_source_claude_enabled"),
    ("agents", ".agents/skills", "skill_source_agents_enabled"),
];

/// Info about a skill source directory shown in the UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSourceInfo {
    pub source: String,
    pub path: String,
    pub enabled: bool,
    pub always_on: bool,
    pub exists: bool,
}

/// Return metadata about all skill source directories
#[tauri::command]
pub async fn get_skill_sources(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<SkillSourceInfo>, String> {
    let home = dirs::home_dir().unwrap_or_default();
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let mut sources = Vec::new();

    // ChatShell user dir (always on)
    let user_dir = if home.as_os_str().is_empty() {
        app_data_dir.join("skills")
    } else {
        home.join(".chatshell/skills")
    };
    sources.push(SkillSourceInfo {
        source: "user".to_string(),
        path: user_dir.to_string_lossy().to_string(),
        enabled: true,
        always_on: true,
        exists: user_dir.exists(),
    });

    // External sources
    for (source, rel_path, setting_key) in EXTERNAL_SKILL_SOURCES {
        let dir = home.join(rel_path);
        let enabled = state
            .db
            .get_setting(setting_key)
            .await
            .ok()
            .flatten()
            .map(|v| v != "false")
            .unwrap_or(true);

        sources.push(SkillSourceInfo {
            source: source.to_string(),
            path: dir.to_string_lossy().to_string(),
            enabled,
            always_on: false,
            exists: dir.exists(),
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

/// Build the list of directories to scan based on current settings
async fn build_scan_directories(
    state: &AppState,
    app: &tauri::AppHandle,
) -> Result<Vec<ScanDirectory>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let home = dirs::home_dir().unwrap_or_else(|| app_data_dir.clone());

    let builtin_dir = app
        .path()
        .resource_dir()
        .map(|d| d.join("builtin-skills"))
        .unwrap_or_else(|_| app_data_dir.join("builtin-skills"));

    let user_dir = home.join(".chatshell/skills");

    if let Err(e) = std::fs::create_dir_all(&user_dir) {
        tracing::warn!("⚠️ [scan_skills] Failed to create user skills dir: {}", e);
    }

    let mut dirs = vec![
        ScanDirectory {
            path: builtin_dir,
            source: "builtin".to_string(),
        },
        ScanDirectory {
            path: user_dir,
            source: "user".to_string(),
        },
    ];

    for (source, rel_path, setting_key) in EXTERNAL_SKILL_SOURCES {
        let enabled = state
            .db
            .get_setting(setting_key)
            .await
            .ok()
            .flatten()
            .map(|v| v != "false")
            .unwrap_or(true);

        if enabled {
            dirs.push(ScanDirectory {
                path: home.join(rel_path),
                source: source.to_string(),
            });
        }
    }

    Ok(dirs)
}

/// Scan the filesystem for SKILL.md files and sync them into the database
#[tauri::command]
pub async fn scan_skills(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<Skill>, String> {
    let dirs = build_scan_directories(&state, &app).await?;
    let scanner = SkillScanner::new(dirs);

    let discovered = scanner.scan_all().await.map_err(|e| e.to_string())?;

    let discovered_keys: std::collections::HashSet<(String, String)> = discovered
        .iter()
        .map(|s| (s.name.clone(), s.source.clone()))
        .collect();

    for skill in &discovered {
        if let Err(e) = state
            .db
            .upsert_skill_by_name_and_source(skill.to_create_request())
            .await
        {
            tracing::warn!(
                "⚠️ [scan_skills] Failed to upsert skill '{}' ({}): {}",
                skill.name,
                skill.source,
                e
            );
        }
    }

    // Remove stale skills that no longer exist on the filesystem
    let all_db_skills = state.db.list_skills().await.map_err(|e| e.to_string())?;
    for skill in &all_db_skills {
        if !discovered_keys.contains(&(skill.name.clone(), skill.source.clone())) {
            tracing::info!(
                "[scan_skills] Removing stale skill '{}' ({})",
                skill.name,
                skill.source
            );
            if let Err(e) = state.db.delete_skill(&skill.id).await {
                tracing::warn!(
                    "⚠️ [scan_skills] Failed to delete stale skill '{}': {}",
                    skill.name,
                    e
                );
            }
        }
    }

    state.db.list_skills().await.map_err(|e| e.to_string())
}

/// Open a skill source directory in the system file manager
#[tauri::command]
pub async fn open_skills_directory(app: tauri::AppHandle, source: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;

    let dir = match source.as_str() {
        "user" => home.join(".chatshell/skills"),
        other => EXTERNAL_SKILL_SOURCES
            .iter()
            .find(|(s, _, _)| *s == other)
            .map(|(_, rel_path, _)| home.join(rel_path))
            .ok_or_else(|| format!("Unknown skill source: {}", other))?,
    };

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create skills directory: {}", e))?;

    tauri_plugin_opener::open_path(dir, None::<&str>)
        .map_err(|e| format!("Failed to open skills directory: {}", e))
}

/// Read the content of a skill's SKILL.md file
#[tauri::command]
pub async fn read_skill_content(
    _state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let skill_md = std::path::PathBuf::from(&path).join("SKILL.md");
    tokio::fs::read_to_string(&skill_md)
        .await
        .map_err(|e| format!("Failed to read SKILL.md: {}", e))
}
