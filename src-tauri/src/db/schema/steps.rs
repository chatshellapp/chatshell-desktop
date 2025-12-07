use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_steps_table(pool: &SqlitePool) -> Result<()> {
    // Thinking steps table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS thinking_steps (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            source TEXT DEFAULT 'llm',
            created_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    // Search decisions table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS search_decisions (
            id TEXT PRIMARY KEY,
            reasoning TEXT NOT NULL,
            search_needed INTEGER NOT NULL,
            search_query TEXT,
            search_result_id TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (search_result_id) REFERENCES search_results(id)
        )"
    )
    .execute(pool)
    .await?;

    // Tool calls table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tool_calls (
            id TEXT PRIMARY KEY,
            tool_name TEXT NOT NULL,
            tool_input TEXT,
            tool_output TEXT,
            status TEXT DEFAULT 'pending',
            error TEXT,
            duration_ms INTEGER,
            created_at TEXT NOT NULL,
            completed_at TEXT
        )"
    )
    .execute(pool)
    .await?;

    // Code executions table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS code_executions (
            id TEXT PRIMARY KEY,
            language TEXT NOT NULL,
            code TEXT NOT NULL,
            output TEXT,
            exit_code INTEGER,
            status TEXT DEFAULT 'pending',
            error TEXT,
            duration_ms INTEGER,
            created_at TEXT NOT NULL,
            completed_at TEXT
        )"
    )
    .execute(pool)
    .await?;

    // Message steps junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS message_steps (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            step_type TEXT NOT NULL CHECK(step_type IN ('thinking', 'search_decision', 'tool_call', 'code_execution')),
            step_id TEXT NOT NULL,
            display_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_message_steps_message ON message_steps(message_id)"
    )
    .execute(pool)
    .await?;

    Ok(())
}

