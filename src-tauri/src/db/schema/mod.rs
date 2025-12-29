use anyhow::Result;
use sqlx::SqlitePool;

mod assistants;
mod conversation_settings;
mod conversations;
mod knowledge;
mod messages;
mod model_parameter_presets;
mod prompts;
mod providers;
mod settings;
mod steps;
mod users;

/// Current schema version. Increment this when adding new migrations.
const CURRENT_SCHEMA_VERSION: i32 = 4;

async fn get_user_version(pool: &SqlitePool) -> Result<i32> {
    let row: (i32,) = sqlx::query_as("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

async fn set_user_version(pool: &SqlitePool, version: i32) -> Result<()> {
    // PRAGMA statements cannot use bound parameters
    sqlx::query(&format!("PRAGMA user_version = {}", version))
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn init_schema(pool: &SqlitePool) -> Result<()> {
    // Enable foreign keys
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(pool)
        .await?;

    let current_version = get_user_version(pool).await?;
    tracing::info!(
        "Database version: {}, target version: {}",
        current_version,
        CURRENT_SCHEMA_VERSION
    );

    // Run migrations based on current version
    if current_version < 1 {
        migrate_v0_to_v1(pool).await?;
        set_user_version(pool, 1).await?;
        tracing::info!("Migration to v1 completed");
    }

    if current_version < 2 {
        migrate_v1_to_v2(pool).await?;
        set_user_version(pool, 2).await?;
        tracing::info!("Migration to v2 completed");
    }

    if current_version < 3 {
        migrate_v2_to_v3(pool).await?;
        set_user_version(pool, 3).await?;
        tracing::info!("Migration to v3 completed");
    }

    if current_version < 4 {
        migrate_v3_to_v4(pool).await?;
        set_user_version(pool, 4).await?;
        tracing::info!("Migration to v4 completed");
    }

    Ok(())
}

/// Initial schema (v1) - used for fresh installations
async fn migrate_v0_to_v1(pool: &SqlitePool) -> Result<()> {
    providers::create_providers_table(pool).await?;
    providers::create_models_table(pool).await?;
    model_parameter_presets::create_model_parameter_presets_table(pool).await?;
    assistants::create_assistants_table(pool).await?;
    users::create_users_table(pool).await?;
    conversations::create_conversations_table(pool).await?;
    knowledge::create_knowledge_bases_table(pool).await?;
    knowledge::create_tools_table(pool).await?;
    messages::create_messages_table(pool).await?;
    messages::create_files_table(pool).await?;
    messages::create_contexts_table(pool).await?;
    steps::create_steps_table(pool).await?;
    prompts::create_prompts_table(pool).await?;
    settings::create_settings_table(pool).await?;

    Ok(())
}

/// Migration v1 -> v2: Add conversation_settings table
async fn migrate_v1_to_v2(pool: &SqlitePool) -> Result<()> {
    conversation_settings::create_conversation_settings_table(pool).await?;
    Ok(())
}

/// Migration v2 -> v3: Add enabled_mcp_server_ids column to conversation_settings
async fn migrate_v2_to_v3(pool: &SqlitePool) -> Result<()> {
    // Add enabled_mcp_server_ids column if it doesn't exist
    // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check manually
    let columns: Vec<(String,)> =
        sqlx::query_as("SELECT name FROM pragma_table_info('conversation_settings')")
            .fetch_all(pool)
            .await?;

    let has_column = columns
        .iter()
        .any(|(name,)| name == "enabled_mcp_server_ids");

    if !has_column {
        sqlx::query("ALTER TABLE conversation_settings ADD COLUMN enabled_mcp_server_ids TEXT")
            .execute(pool)
            .await?;
        tracing::info!("Added enabled_mcp_server_ids column to conversation_settings table");
    }

    Ok(())
}

/// Migration v3 -> v4: Ensure all step-related tables exist
/// This fixes databases that were created before content_blocks table was added
async fn migrate_v3_to_v4(pool: &SqlitePool) -> Result<()> {
    // Re-run create_steps_table which uses CREATE TABLE IF NOT EXISTS
    // This will create any missing tables (like content_blocks) without affecting existing ones
    steps::create_steps_table(pool).await?;
    tracing::info!("Ensured all step-related tables exist (thinking_steps, search_decisions, tool_calls, code_executions, content_blocks)");
    Ok(())
}
