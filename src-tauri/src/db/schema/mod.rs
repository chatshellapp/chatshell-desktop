use anyhow::Result;
use sqlx::SqlitePool;

mod providers;
mod assistants;
mod users;
mod conversations;
mod messages;
mod steps;
mod knowledge;
mod prompts;
mod settings;

pub async fn init_schema(pool: &SqlitePool) -> Result<()> {
    // Enable foreign keys
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(pool)
        .await?;

    providers::create_providers_table(pool).await?;
    providers::create_models_table(pool).await?;
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

