use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_messages_table(pool: &SqlitePool) -> Result<()> {
    // Messages table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            sender_type TEXT NOT NULL,
            sender_id TEXT,
            content TEXT NOT NULL,
            tokens INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
         ON messages(conversation_id, created_at DESC)"
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn create_files_table(pool: &SqlitePool) -> Result<()> {
    // Files table (user attachments)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mime_type TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            content_hash TEXT,
            created_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash)"
    )
    .execute(pool)
    .await?;

    // User links table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS user_links (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT,
            created_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    // Message attachments junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS message_attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            attachment_type TEXT NOT NULL CHECK(attachment_type IN ('file', 'user_link')),
            attachment_id TEXT NOT NULL,
            display_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id)"
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn create_contexts_table(pool: &SqlitePool) -> Result<()> {
    // Search results table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS search_results (
            id TEXT PRIMARY KEY,
            query TEXT NOT NULL,
            engine TEXT NOT NULL,
            total_results INTEGER,
            searched_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    // Fetch results table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS fetch_results (
            id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL DEFAULT 'search',
            source_id TEXT,
            url TEXT NOT NULL,
            title TEXT,
            description TEXT,
            storage_path TEXT NOT NULL,
            content_type TEXT NOT NULL,
            original_mime TEXT,
            status TEXT DEFAULT 'pending',
            error TEXT,
            keywords TEXT,
            headings TEXT,
            original_size INTEGER,
            processed_size INTEGER,
            favicon_url TEXT,
            content_hash TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_fetch_results_source ON fetch_results(source_type, source_id)"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_fetch_results_content_hash ON fetch_results(content_hash)"
    )
    .execute(pool)
    .await?;

    // Message contexts junction table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS message_contexts (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            context_type TEXT NOT NULL CHECK(context_type IN ('search_result', 'fetch_result')),
            context_id TEXT NOT NULL,
            display_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_message_contexts_message ON message_contexts(message_id)"
    )
    .execute(pool)
    .await?;

    Ok(())
}

