use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_knowledge_bases_table(pool: &SqlitePool) -> Result<()> {
    // Knowledge bases table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS knowledge_bases (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT,
            url TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    // Assistant-KnowledgeBase junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS assistant_knowledge_bases (
            id TEXT PRIMARY KEY,
            assistant_id TEXT NOT NULL,
            knowledge_base_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE,
            FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
            UNIQUE(assistant_id, knowledge_base_id)
        )"
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn create_tools_table(pool: &SqlitePool) -> Result<()> {
    // Tools table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tools (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            endpoint TEXT,
            config TEXT,
            description TEXT,
            is_enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    // Assistant-Tool junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS assistant_tools (
            id TEXT PRIMARY KEY,
            assistant_id TEXT NOT NULL,
            tool_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE,
            FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
            UNIQUE(assistant_id, tool_id)
        )"
    )
    .execute(pool)
    .await?;

    Ok(())
}

