use anyhow::Result;
use sqlx::SqlitePool;

pub async fn create_conversations_table(pool: &SqlitePool) -> Result<()> {
    // Conversations table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    // Conversation participants table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversation_participants (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            participant_type TEXT NOT NULL,
            participant_id TEXT,
            display_name TEXT,
            role TEXT DEFAULT 'member',
            status TEXT DEFAULT 'active',
            joined_at TEXT NOT NULL,
            left_at TEXT,
            last_read_at TEXT,
            metadata TEXT,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            UNIQUE(conversation_id, participant_type, participant_id)
        )",
    )
    .execute(pool)
    .await?;

    // Indexes
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation 
         ON conversation_participants(conversation_id)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_conversation_participants_status 
         ON conversation_participants(conversation_id, status)",
    )
    .execute(pool)
    .await?;

    Ok(())
}
