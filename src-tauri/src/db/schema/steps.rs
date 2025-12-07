use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_steps_table(pool: &SqlitePool) -> Result<()> {
    // Thinking steps table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS thinking_steps (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            content TEXT NOT NULL,
            source TEXT DEFAULT 'llm',
            display_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_thinking_steps_message ON thinking_steps(message_id)"
    )
    .execute(pool)
    .await?;

    // Search decisions table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS search_decisions (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            reasoning TEXT NOT NULL,
            search_needed INTEGER NOT NULL,
            search_query TEXT,
            search_result_id TEXT,
            display_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (search_result_id) REFERENCES search_results(id) ON DELETE SET NULL
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_search_decisions_message ON search_decisions(message_id)"
    )
    .execute(pool)
    .await?;

    // Tool calls table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tool_calls (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            tool_input TEXT,
            tool_output TEXT,
            status TEXT DEFAULT 'pending',
            error TEXT,
            duration_ms INTEGER,
            display_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id)"
    )
    .execute(pool)
    .await?;

    // Code executions table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS code_executions (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            language TEXT NOT NULL,
            code TEXT NOT NULL,
            output TEXT,
            exit_code INTEGER,
            status TEXT DEFAULT 'pending',
            error TEXT,
            duration_ms INTEGER,
            display_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_code_executions_message ON code_executions(message_id)"
    )
    .execute(pool)
    .await?;

    Ok(())
}

