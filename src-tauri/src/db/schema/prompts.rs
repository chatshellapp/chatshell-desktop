use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_prompts_table(pool: &SqlitePool) -> Result<()> {
    // Prompts table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS prompts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            description TEXT,
            category TEXT,
            is_system INTEGER DEFAULT 0,
            is_starred INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    // Add is_starred column if it doesn't exist (migration)
    sqlx::query("ALTER TABLE prompts ADD COLUMN is_starred INTEGER DEFAULT 0")
        .execute(pool)
        .await
        .ok(); // Ignore errors if column already exists

    // Message-Prompt junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS message_prompts (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            prompt_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
            UNIQUE(message_id, prompt_id)
        )",
    )
    .execute(pool)
    .await?;

    // Message-KnowledgeBase junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS message_knowledge_bases (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            knowledge_base_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
            UNIQUE(message_id, knowledge_base_id)
        )",
    )
    .execute(pool)
    .await?;

    // Message-Tool junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS message_tools (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            tool_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
            UNIQUE(message_id, tool_id)
        )",
    )
    .execute(pool)
    .await?;

    Ok(())
}
