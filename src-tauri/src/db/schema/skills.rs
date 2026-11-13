use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_skills_table(pool: &SqlitePool) -> Result<()> {
    // Skills table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            source TEXT NOT NULL DEFAULT 'user',
            path TEXT NOT NULL,
            icon TEXT,
            required_tool_ids TEXT,
            allow_model_invocation INTEGER DEFAULT 1,
            allow_user_invocation INTEGER DEFAULT 1,
            content_hash TEXT,
            cached_instructions TEXT,
            is_enabled INTEGER DEFAULT 1,
            files_manifest TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(name, source)
        )",
    )
    .execute(pool)
    .await?;

    // Assistant-Skill junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS assistant_skills (
            id TEXT PRIMARY KEY,
            assistant_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE,
            FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
            UNIQUE(assistant_id, skill_id)
        )",
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Device-local reconcile state for ChatShell's own skills (created in
/// `data.local.db`, never synced): the content hash of the files this device
/// last had in sync with the skill row.
pub async fn create_skill_local_state_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skill_local_state (
            skill_id TEXT PRIMARY KEY,
            content_hash TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}
