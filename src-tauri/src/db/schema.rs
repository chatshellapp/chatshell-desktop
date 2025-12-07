use anyhow::Result;
use sqlx::SqlitePool;

pub async fn init_schema(pool: &SqlitePool) -> Result<()> {
    // Enable foreign keys
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(pool)
        .await?;

    create_providers_table(pool).await?;
    create_models_table(pool).await?;
    create_assistants_table(pool).await?;
    create_users_table(pool).await?;
    create_conversations_table(pool).await?;
    create_knowledge_bases_table(pool).await?;
    create_tools_table(pool).await?;
    create_messages_table(pool).await?;
    create_files_table(pool).await?;
    create_contexts_table(pool).await?;
    create_steps_table(pool).await?;
    create_prompts_table(pool).await?;
    create_settings_table(pool).await?;

    Ok(())
}

async fn create_providers_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider_type TEXT NOT NULL,
            api_key TEXT,
            base_url TEXT,
            description TEXT,
            is_enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn create_models_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            description TEXT,
            is_starred INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn create_assistants_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS assistants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT,
            description TEXT,
            system_prompt TEXT NOT NULL,
            user_prompt TEXT,
            model_id TEXT NOT NULL,
            temperature REAL,
            max_tokens INTEGER,
            top_p REAL,
            frequency_penalty REAL,
            presence_penalty REAL,
            additional_params TEXT,
            avatar_type TEXT DEFAULT 'text',
            avatar_bg TEXT,
            avatar_text TEXT,
            avatar_image_path TEXT,
            avatar_image_url TEXT,
            group_name TEXT,
            is_starred INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (model_id) REFERENCES models(id)
        )"
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn create_users_table(pool: &SqlitePool) -> Result<()> {
    // Users table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            email TEXT UNIQUE,
            avatar_type TEXT DEFAULT 'text',
            avatar_bg TEXT,
            avatar_text TEXT,
            avatar_image_path TEXT,
            avatar_image_url TEXT,
            is_self INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            last_seen_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    // User relationships table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS user_relationships (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            related_user_id TEXT NOT NULL,
            relationship_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, related_user_id)
        )"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_user_relationships_user 
         ON user_relationships(user_id, relationship_type)"
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn create_conversations_table(pool: &SqlitePool) -> Result<()> {
    // Conversations table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
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
        )"
    )
    .execute(pool)
    .await?;

    // Indexes
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation 
         ON conversation_participants(conversation_id)"
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_conversation_participants_status 
         ON conversation_participants(conversation_id, status)"
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn create_knowledge_bases_table(pool: &SqlitePool) -> Result<()> {
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

async fn create_tools_table(pool: &SqlitePool) -> Result<()> {
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

async fn create_messages_table(pool: &SqlitePool) -> Result<()> {
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

async fn create_files_table(pool: &SqlitePool) -> Result<()> {
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

async fn create_contexts_table(pool: &SqlitePool) -> Result<()> {
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

async fn create_steps_table(pool: &SqlitePool) -> Result<()> {
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

async fn create_prompts_table(pool: &SqlitePool) -> Result<()> {
    // Prompts table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS prompts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            description TEXT,
            category TEXT,
            is_system INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

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
        )"
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
        )"
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
        )"
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn create_settings_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    Ok(())
}

