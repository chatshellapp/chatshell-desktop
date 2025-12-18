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
const CURRENT_SCHEMA_VERSION: i32 = 2;

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
