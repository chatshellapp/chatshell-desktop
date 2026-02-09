use super::AppState;
use crate::models::{CreateSkillRequest, Skill};
use crate::skills::SkillScanner;
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

/// Scan the filesystem for SKILL.md files and sync them into the database
#[tauri::command]
pub async fn scan_skills(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<Skill>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let builtin_dir = app
        .path()
        .resource_dir()
        .map(|d| d.join("builtin-skills"))
        .unwrap_or_else(|_| app_data_dir.join("builtin-skills"));

    let user_dir = dirs::home_dir()
        .unwrap_or_else(|| app_data_dir.clone())
        .join(".chatshell")
        .join("skills");

    // Ensure user skills directory exists
    if let Err(e) = std::fs::create_dir_all(&user_dir) {
        tracing::warn!("⚠️ [scan_skills] Failed to create user skills dir: {}", e);
    }

    let scanner = SkillScanner::new(builtin_dir, user_dir);

    let discovered = scanner.scan_all().await.map_err(|e| e.to_string())?;

    // Upsert each discovered skill
    for skill in &discovered {
        if let Err(e) = state
            .db
            .upsert_skill_by_name(skill.to_create_request())
            .await
        {
            tracing::warn!(
                "⚠️ [scan_skills] Failed to upsert skill '{}': {}",
                skill.name,
                e
            );
        }
    }

    // Return all skills from DB (includes both discovered and manually created)
    state.db.list_skills().await.map_err(|e| e.to_string())
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
