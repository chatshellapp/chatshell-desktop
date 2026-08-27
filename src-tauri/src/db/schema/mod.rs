use anyhow::Result;
use sqlx::Row;
use sqlx::SqlitePool;

mod assistants;
mod compactions;
mod conversation_settings;
mod conversations;
mod messages;
mod model_parameter_presets;
mod prompts;
mod providers;
mod search;
mod settings;
mod skills;
mod steps;
mod tools;
mod users;

/// Current schema version. Increment this when adding new migrations.
const CURRENT_SCHEMA_VERSION: i32 = 11;

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

    if current_version < 5 {
        migrate_v4_to_v5(pool).await?;
        set_user_version(pool, 5).await?;
        tracing::info!("Migration to v5 completed");
    }

    if current_version < 6 {
        migrate_v5_to_v6(pool).await?;
        set_user_version(pool, 6).await?;
        tracing::info!("Migration to v6 completed");
    }

    if current_version < 7 {
        migrate_v6_to_v7(pool).await?;
        set_user_version(pool, 7).await?;
        tracing::info!("Migration to v7 completed");
    }

    if current_version < 8 {
        migrate_v7_to_v8(pool).await?;
        set_user_version(pool, 8).await?;
        tracing::info!("Migration to v8 completed");
    }

    if current_version < 9 {
        migrate_v8_to_v9(pool).await?;
        set_user_version(pool, 9).await?;
        tracing::info!("Migration to v9 completed");
    }

    if current_version < 10 {
        migrate_v9_to_v10(pool).await?;
        set_user_version(pool, 10).await?;
        tracing::info!("Migration to v10 completed");
    }

    if current_version < 11 {
        migrate_v10_to_v11(pool).await?;
        set_user_version(pool, 11).await?;
        tracing::info!("Migration to v11 completed");
    }

    // Ensure columns exist (idempotent, fixes databases
    // that were bumped to a version before the columns were actually added)
    ensure_enabled_skill_ids_column(pool).await?;
    ensure_working_directory_column(pool).await?;
    ensure_api_style_column(pool).await?;
    ensure_auth_token_column(pool).await?;
    ensure_tool_call_id_column(pool).await?;
    ensure_natural_key_unique_indexes(pool).await?;
    ensure_conversation_timestamps(pool).await?;

    Ok(())
}

/// Ensure updated_at exists on conversation_settings and
/// conversation_participants. Repairs developer databases created by
/// intermediate builds whose migration omitted these columns; idempotent.
async fn ensure_conversation_timestamps(pool: &SqlitePool) -> Result<()> {
    for table in ["conversation_settings", "conversation_participants"] {
        let columns = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(pool)
            .await?;
        let has_column = columns.iter().any(|row| {
            row.try_get::<String, _>("name")
                .is_ok_and(|name| name == "updated_at")
        });
        if !has_column {
            sqlx::query(&format!(
                "ALTER TABLE {table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"
            ))
            .execute(pool)
            .await?;
            tracing::info!("Added updated_at column to {table} table");
        }
    }
    Ok(())
}

/// Natural-key UNIQUE indexes the sync engine's merge specs use as
/// `ON CONFLICT` targets. Repairs developer databases created by
/// intermediate builds whose migration lacked these indexes; idempotent.
async fn ensure_natural_key_unique_indexes(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_message_attachments_uniq \
         ON message_attachments(message_id, attachment_id)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_message_contexts_uniq \
         ON message_contexts(message_id, context_type, context_id)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Migration v10 -> v11: sync-readiness rollout, compaction events, and
/// natural-key indexes (ADR 01 snapshot sync). This collapses what shipped
/// as v11-v15 across local development builds into a single step; no
/// released build ever wrote a user_version above 10. It also folds in the
/// short-lived dev-build v12/v13: system rows seed deterministic ids at
/// insert time (db::system_ids), and the never-shipped knowledge-base /
/// user-relationship tables are dropped here. Databases stamped 12/13 by
/// intermediate dev builds are already converged or disposable - dev
/// stage, no migration debt carried.
///
/// - `updated_at` on every synced table (validate_registry requires it on
///   ALL of them): NOT NULL with '' default, backfilled from
///   COALESCE(completed_at, created_at) where those columns exist.
/// - `deleted_at` soft-delete tombstones on synced entity tables. Hard DELETEs
///   cannot propagate through the append-only merge; tombstones ride ordinary
///   LWW row updates instead.
/// - `meta` key-value table holds snapshot-sync versioning
///   (sync_version / device_id); `compactions` records context-compaction
///   events.
/// - Natural-key UNIQUE indexes the sync engine's mutable merge specs use as
///   `ON CONFLICT` targets, so unbind/removal updates propagate to peers.
async fn migrate_v10_to_v11(pool: &SqlitePool) -> Result<()> {
    // tool_calls/code_executions carry completed_at; messages/search_results
    // backfill from created_at directly. Remaining synced tables keep the ''
    // default; their rows are written fresh by the app.
    for table in ["tool_calls", "code_executions"] {
        sqlx::query(&format!(
            "ALTER TABLE {table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"
        ))
        .execute(pool)
        .await?;
        sqlx::query(&format!(
            "UPDATE {table} SET updated_at = COALESCE(completed_at, created_at)"
        ))
        .execute(pool)
        .await?;
    }
    for table in ["messages", "search_results"] {
        sqlx::query(&format!(
            "ALTER TABLE {table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"
        ))
        .execute(pool)
        .await?;
        sqlx::query(&format!("UPDATE {table} SET updated_at = created_at"))
            .execute(pool)
            .await?;
    }
    // Some synced tables already define updated_at in their CREATE TABLE,
    // so these additions are conditional.
    async fn add_column_if_missing(
        pool: &SqlitePool,
        table: &str,
        column: &str,
        decl: &str,
    ) -> Result<()> {
        let columns = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(pool)
            .await?;
        let exists = columns.iter().any(|row| {
            row.try_get::<String, _>("name")
                .is_ok_and(|name| name == column)
        });
        if !exists {
            sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"))
                .execute(pool)
                .await?;
        }
        Ok(())
    }

    for table in [
        "files",
        "search_decisions",
        "thinking_steps",
        "content_blocks",
        "message_attachments",
        "message_contexts",
        "message_prompts",
        "message_tools",
        "assistant_tools",
        "assistant_skills",
        "conversation_settings",
        "conversation_participants",
    ] {
        add_column_if_missing(pool, table, "updated_at", "TEXT NOT NULL DEFAULT ''").await?;
    }
    for table in [
        "conversations",
        "messages",
        "tool_calls",
        "code_executions",
        "files",
        "assistants",
        "tools",
        "providers",
        "models",
        "prompts",
        "skills",
        "model_parameter_presets",
        "users",
        "fetch_results",
        "search_results",
        "settings",
        "conversation_settings",
        "conversation_participants",
        "search_decisions",
        "thinking_steps",
        "content_blocks",
        "message_attachments",
        "message_contexts",
        "message_prompts",
        "message_tools",
        "assistant_tools",
        "assistant_skills",
    ] {
        sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN deleted_at TEXT"))
            .execute(pool)
            .await?;
    }

    settings::create_meta_table(pool).await?;
    compactions::create_compactions_table(pool).await?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_message_attachments_uniq \
         ON message_attachments(message_id, attachment_id)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_message_contexts_uniq \
         ON message_contexts(message_id, context_type, context_id)",
    )
    .execute(pool)
    .await?;

    // Folded from dev-build v13: tables created by the v1 ladder that no
    // feature code ever wrote; they existed only in the sync schema's
    // merge registry, costing cross-device schema lockstep for nothing.
    // Children drop before parents so FK constraints hold.
    for table in [
        "message_knowledge_bases",
        "assistant_knowledge_bases",
        "knowledge_bases",
        "user_relationships",
    ] {
        sqlx::query(&format!("DROP TABLE IF EXISTS {table}"))
            .execute(pool)
            .await?;
    }

    tracing::info!(
        "Added sync-readiness columns, meta/compactions tables, and natural-key indexes; \
         dropped never-shipped tables"
    );
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
    tools::create_tools_table(pool).await?;
    skills::create_skills_table(pool).await?;
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
    tracing::info!(
        "Ensured all step-related tables exist (thinking_steps, search_decisions, tool_calls, code_executions, content_blocks)"
    );
    Ok(())
}

/// Migration v4 -> v5: Add skills and assistant_skills tables
async fn migrate_v4_to_v5(pool: &SqlitePool) -> Result<()> {
    skills::create_skills_table(pool).await?;
    tracing::info!("Created skills and assistant_skills tables");
    Ok(())
}

/// Migration v5 -> v6: Add enabled_skill_ids and working_directory columns to conversation_settings
async fn migrate_v5_to_v6(pool: &SqlitePool) -> Result<()> {
    ensure_enabled_skill_ids_column(pool).await?;
    ensure_working_directory_column(pool).await?;
    Ok(())
}

/// Ensure enabled_skill_ids column exists in conversation_settings (idempotent)
async fn ensure_enabled_skill_ids_column(pool: &SqlitePool) -> Result<()> {
    let columns: Vec<(String,)> =
        sqlx::query_as("SELECT name FROM pragma_table_info('conversation_settings')")
            .fetch_all(pool)
            .await?;

    let has_column = columns.iter().any(|(name,)| name == "enabled_skill_ids");

    if !has_column {
        sqlx::query("ALTER TABLE conversation_settings ADD COLUMN enabled_skill_ids TEXT")
            .execute(pool)
            .await?;
        tracing::info!("Added enabled_skill_ids column to conversation_settings table");
    }

    Ok(())
}

/// Migration v6 -> v7: Add api_style column to providers for custom provider support
async fn migrate_v6_to_v7(pool: &SqlitePool) -> Result<()> {
    ensure_api_style_column(pool).await?;
    Ok(())
}

/// Ensure api_style column exists in providers (idempotent)
async fn ensure_api_style_column(pool: &SqlitePool) -> Result<()> {
    let columns: Vec<(String,)> = sqlx::query_as("SELECT name FROM pragma_table_info('providers')")
        .fetch_all(pool)
        .await?;

    let has_column = columns.iter().any(|(name,)| name == "api_style");

    if !has_column {
        sqlx::query("ALTER TABLE providers ADD COLUMN api_style TEXT")
            .execute(pool)
            .await?;
        tracing::info!("Added api_style column to providers table");
    }

    Ok(())
}

/// Ensure working_directory column exists in conversation_settings (idempotent)
async fn ensure_working_directory_column(pool: &SqlitePool) -> Result<()> {
    let columns: Vec<(String,)> =
        sqlx::query_as("SELECT name FROM pragma_table_info('conversation_settings')")
            .fetch_all(pool)
            .await?;

    let has_column = columns.iter().any(|(name,)| name == "working_directory");

    if !has_column {
        sqlx::query("ALTER TABLE conversation_settings ADD COLUMN working_directory TEXT")
            .execute(pool)
            .await?;
        tracing::info!("Added working_directory column to conversation_settings table");
    }

    Ok(())
}

/// Migration v7 -> v8: Add auth_token column to tools table.
/// MCP auth tokens (Bearer / OAuth) are now encrypted and stored in SQLite
/// instead of the OS keychain, so macOS no longer prompts for keychain access.
async fn migrate_v7_to_v8(pool: &SqlitePool) -> Result<()> {
    ensure_auth_token_column(pool).await?;
    Ok(())
}

/// Ensure auth_token column exists in tools (idempotent)
async fn ensure_auth_token_column(pool: &SqlitePool) -> Result<()> {
    let columns: Vec<(String,)> = sqlx::query_as("SELECT name FROM pragma_table_info('tools')")
        .fetch_all(pool)
        .await?;

    let has_column = columns.iter().any(|(name,)| name == "auth_token");

    if !has_column {
        sqlx::query("ALTER TABLE tools ADD COLUMN auth_token TEXT")
            .execute(pool)
            .await?;
        tracing::info!("Added auth_token column to tools table");
    }

    Ok(())
}

/// Migration v8 -> v9: Add FTS5 virtual table for chat history search.
/// Backfill of existing messages is done in Database::backfill_fts() after init.
async fn migrate_v8_to_v9(pool: &SqlitePool) -> Result<()> {
    search::create_messages_fts_table(pool).await?;
    tracing::info!("Created messages_fts FTS5 table for search");
    Ok(())
}

/// Ensure call_id column exists in tool_calls (idempotent)
async fn ensure_tool_call_id_column(pool: &SqlitePool) -> Result<()> {
    let columns: Vec<(String,)> =
        sqlx::query_as("SELECT name FROM pragma_table_info('tool_calls')")
            .fetch_all(pool)
            .await?;

    let has_column = columns.iter().any(|(name,)| name == "call_id");

    if !has_column {
        sqlx::query("ALTER TABLE tool_calls ADD COLUMN call_id TEXT")
            .execute(pool)
            .await?;
        tracing::info!("Added call_id column to tool_calls table");
    }

    Ok(())
}

/// Migration v9 -> v10: Fix skills table unique constraint.
/// The old schema had `name UNIQUE` which prevented skills with the same name from
/// different sources (e.g. claude, agents). The new schema uses UNIQUE(name, source).
async fn migrate_v9_to_v10(pool: &SqlitePool) -> Result<()> {
    // SQLite cannot drop/modify constraints, so we drop and recreate the skills tables.
    // assistant_skills must be dropped first due to the FK reference.
    sqlx::query("DROP TABLE IF EXISTS assistant_skills")
        .execute(pool)
        .await?;
    sqlx::query("DROP TABLE IF EXISTS skills")
        .execute(pool)
        .await?;
    skills::create_skills_table(pool).await?;
    tracing::info!("Recreated skills and assistant_skills tables with UNIQUE(name, source)");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn fresh_pool() -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory pool")
    }

    async fn columns(pool: &SqlitePool, table: &str) -> Vec<String> {
        let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(pool)
            .await
            .unwrap();
        rows.iter()
            .map(|row| row.try_get::<String, _>("name").unwrap())
            .collect()
    }

    /// Table -> sorted column names for every non-internal table.
    async fn table_column_map(
        pool: &SqlitePool,
    ) -> std::collections::BTreeMap<String, Vec<String>> {
        let names: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'messages_fts%'",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        let mut map = std::collections::BTreeMap::new();
        for table in names {
            let mut cols = columns(pool, &table).await;
            cols.sort();
            map.insert(table, cols);
        }
        map
    }

    /// The canonical sync schema (core `sync_schema`) must match the desktop
    /// ladder endpoint exactly: `merge_remote` builds its SELECT list from
    /// local columns, so a column added here without updating the shared
    /// constant breaks the next device's merge, and vice versa.
    #[tokio::test]
    async fn canonical_sync_schema_matches_ladder_endpoint() {
        let ladder_pool = fresh_pool().await;
        init_schema(&ladder_pool).await.expect("init schema");
        let canonical_pool = fresh_pool().await;
        sqlx::raw_sql(chatshell_agent_core::sync_schema::SYNC_SCHEMA_SQL)
            .execute(&canonical_pool)
            .await
            .expect("apply canonical schema");

        let ladder = table_column_map(&ladder_pool).await;
        let canonical = table_column_map(&canonical_pool).await;
        assert_eq!(ladder, canonical);
    }

    #[tokio::test]
    async fn fresh_database_has_sync_columns_and_meta() {
        let pool = fresh_pool().await;
        init_schema(&pool).await.expect("init schema");

        let version: (i32,) = sqlx::query_as("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version.0, CURRENT_SCHEMA_VERSION);

        for table in [
            "messages",
            "tool_calls",
            "code_executions",
            "search_results",
            "conversation_settings",
            "conversation_participants",
        ] {
            let cols = columns(&pool, table).await;
            assert!(
                cols.contains(&"updated_at".to_string()),
                "{table}.updated_at missing: {cols:?}"
            );
        }

        for table in [
            "conversations",
            "messages",
            "tool_calls",
            "files",
            "assistants",
            "tools",
            "providers",
            "models",
            "prompts",
            "skills",
            "model_parameter_presets",
            "users",
            "fetch_results",
        ] {
            let cols = columns(&pool, table).await;
            assert!(
                cols.contains(&"deleted_at".to_string()),
                "{table}.deleted_at missing: {cols:?}"
            );
        }

        sqlx::query("INSERT INTO meta(key, value, updated_at) VALUES('sync_version', '1:test', '2026-08-21T00:00:00+00:00')")
            .execute(&pool)
            .await
            .expect("meta table writable");
    }

    #[tokio::test]
    async fn tool_call_update_maintains_updated_at() {
        let pool = fresh_pool().await;
        init_schema(&pool).await.unwrap();

        sqlx::query("INSERT INTO conversations(id, title, created_at, updated_at) VALUES('c1', 't', '2026-08-21T00:00:00+00:00', '2026-08-21T00:00:00+00:00')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO messages(id, conversation_id, sender_type, content, created_at, updated_at) VALUES('m1', 'c1', 'user', 'hi', '2026-08-21T00:00:01+00:00', '2026-08-21T00:00:01+00:00')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO tool_calls(id, message_id, tool_name, status, created_at, updated_at) VALUES('tc1', 'm1', 'bash', 'pending', '2026-08-21T00:00:02+00:00', '2026-08-21T00:00:02+00:00')")
            .execute(&pool).await.unwrap();

        sqlx::query("UPDATE tool_calls SET status = 'completed', completed_at = '2026-08-21T00:00:09+00:00', updated_at = '2026-08-21T00:00:09+00:00' WHERE id = 'tc1'")
            .execute(&pool).await.unwrap();

        let (updated_at,): (String,) =
            sqlx::query_as("SELECT updated_at FROM tool_calls WHERE id = 'tc1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(updated_at, "2026-08-21T00:00:09+00:00");
    }
}
