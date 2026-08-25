//! Payload-wiping soft deletes.
//!
//! Soft-deleted rows keep only their identity skeleton: primary key, foreign
//! keys / natural-key columns (merge `ON CONFLICT` targets), timestamps and
//! the `deleted_at` tombstone. Everything else is blanked — `NOT NULL` text
//! columns to `''`, nullable payload to `NULL`.
//!
//! Why wipe instead of keep:
//! - deleted content stops traveling in every published snapshot (privacy);
//! - tombstones cost bytes, not whole tool outputs (tool_calls is the
//!   dominant growth table);
//! - whole-row LWW still propagates the deletion: the wiped row is just an
//!   updated row.
//!
//! Natural-key columns must survive (a wiped `participant_type` or `name`
//! would make the tombstone miss the peer's `ON CONFLICT` target and insert
//! as a new row instead of overwriting the live one).

/// Wipe fragment for one table's payload columns (without the trailing
/// `deleted_at`/`updated_at` SETs, which every caller needs).
pub fn wipe_fragment(table: &str) -> Option<&'static str> {
    Some(match table {
        "conversations" => "title = ''",
        "messages" => "sender_type = '', content = '', tokens = NULL",
        "assistants" => {
            "name = '', role = NULL, description = NULL, system_prompt = '', \
             user_prompt = NULL, avatar_type = NULL, avatar_bg = NULL, avatar_text = NULL, \
             avatar_image_path = NULL, avatar_image_url = NULL, group_name = NULL, \
             is_starred = NULL"
        }
        "providers" => {
            "provider_type = '', api_key = NULL, base_url = NULL, api_style = NULL, \
             description = NULL, is_enabled = NULL"
        }
        "prompts" => {
            "content = '', description = NULL, category = NULL, is_system = NULL, \
             is_starred = NULL"
        }
        "skills" => {
            "description = NULL, path = '', icon = NULL, required_tool_ids = NULL, \
             allow_model_invocation = NULL, allow_user_invocation = NULL, \
             content_hash = NULL, cached_instructions = NULL, is_enabled = NULL"
        }
        "tools" => {
            "type = '', endpoint = NULL, config = NULL, description = NULL, \
             is_enabled = NULL, auth_token = NULL"
        }
        "model_parameter_presets" => {
            "description = NULL, temperature = NULL, max_tokens = NULL, top_p = NULL, \
             frequency_penalty = NULL, presence_penalty = NULL, additional_params = NULL, \
             is_system = NULL, is_default = NULL"
        }
        "fetch_results" => {
            "source_type = '', url = '', title = NULL, description = NULL, storage_path = '', \
             content_type = '', original_mime = NULL, status = NULL, error = NULL, \
             keywords = NULL, headings = NULL, original_size = NULL, processed_size = NULL, \
             favicon_url = NULL, content_hash = NULL"
        }
        "search_results" => {
            "query = '', engine = '', total_results = NULL, display_order = NULL, \
             searched_at = ''"
        }
        "tool_calls" => {
            "tool_input = NULL, tool_output = NULL, status = NULL, error = NULL, \
             duration_ms = NULL, display_order = NULL, completed_at = NULL"
        }
        "thinking_steps" => "content = '', display_order = NULL",
        "search_decisions" => {
            "reasoning = '', search_needed = '', search_query = NULL, display_order = NULL"
        }
        "code_executions" => {
            "language = '', code = '', output = NULL, exit_code = NULL, status = NULL, \
             error = NULL, duration_ms = NULL, display_order = NULL, completed_at = NULL"
        }
        "content_blocks" => "content = '', display_order = ''",
        "message_contexts" => "display_order = NULL",
        "message_attachments" => "display_order = NULL",
        "conversation_settings" => {
            "use_provider_defaults = NULL, use_custom_parameters = NULL, \
             parameter_overrides = NULL, context_message_count = NULL, \
             system_prompt_mode = NULL, custom_system_prompt = NULL, user_prompt_mode = NULL, \
             custom_user_prompt = NULL, enabled_mcp_server_ids = NULL, enabled_skill_ids = NULL, \
             working_directory = NULL"
        }
        // Natural key is (conversation_id, participant_type, participant_id):
        // participant_type survives with the FK columns.
        "conversation_participants" => {
            "display_name = NULL, role = NULL, status = NULL, joined_at = '', \
             left_at = NULL, last_read_at = NULL, metadata = NULL"
        }
        // `is_deleted` is the legacy visibility flag; keep it consistent.
        "models" => {
            "name = '', model_id = '', description = NULL, is_starred = NULL, \
             is_deleted = 1"
        }
        // Wiping storage_path/content_hash lets the blob GC reclaim the
        // bytes once the tombstone is older than the grace period.
        "files" => {
            "file_name = '', file_size = 0, mime_type = '', storage_path = '', \
             content_hash = NULL"
        }
        // Junction rows are all-key already: only the tombstone is added.
        "assistant_tools" | "assistant_skills" | "assistant_knowledge_bases" => "",
        _ => return None,
    })
}

/// Build the payload-wiping tombstone UPDATE for `table` with the caller's
/// `where_clause` (anonymous `?` placeholders; the wipe binds `?1`).
pub fn tombstone_update(table: &str, where_clause: &str) -> String {
    let wipe = wipe_fragment(table).unwrap_or_else(|| panic!("no wipe spec for {table}"));
    let payload = if wipe.is_empty() {
        String::new()
    } else {
        format!("{wipe}, ")
    };
    format!("UPDATE {table} SET {payload}deleted_at = ?1, updated_at = ?1 WHERE {where_clause}")
}

/// Per-message child rows that die with their parent message. Tombstoning
/// the parent alone would leave live child rows riding snapshots forever
/// (tool output is the dominant snapshot bulk).
const MESSAGE_CHILD_TABLES: &[&str] = &[
    "tool_calls",
    "thinking_steps",
    "search_results",
    "search_decisions",
    "code_executions",
    "content_blocks",
    "message_contexts",
    "message_attachments",
];

/// Tombstone every per-message child row whose parent matches
/// `message_predicate` (anonymous `?` placeholders, bound from `params`).
/// Call before tombstoning the parent messages themselves, so the predicate
/// still sees them as live.
pub async fn tombstone_children_of_messages(
    pool: &sqlx::sqlite::SqlitePool,
    message_predicate: &str,
    params: &[&str],
) -> anyhow::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    for table in MESSAGE_CHILD_TABLES {
        let sql = tombstone_update(
            table,
            &format!("message_id IN (SELECT id FROM messages WHERE {message_predicate})"),
        );
        let mut query = sqlx::query(&sql).bind(now.clone());
        for param in params {
            query = query.bind(param);
        }
        query.execute(pool).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn canonical_pool() -> sqlx::sqlite::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(chatshell_agent_core::sync_schema::SYNC_SCHEMA_SQL)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    /// Every wipe statement must run against the canonical sync schema:
    /// this catches typos in column names and NOT NULL violations at test
    /// time instead of at first deletion.
    #[tokio::test]
    async fn wipe_statements_run_against_canonical_schema() {
        let pool = canonical_pool().await;
        let cases = [
            ("conversations", "id = ?2"),
            ("messages", "id = ?2"),
            ("assistants", "id = ?2"),
            ("providers", "id = ?2"),
            ("prompts", "id = ?2"),
            ("skills", "id = ?2"),
            ("tools", "id = ?2"),
            ("model_parameter_presets", "id = ?2"),
            ("fetch_results", "id = ?2"),
            ("search_results", "id = ?2"),
            ("tool_calls", "id = ?2"),
            ("thinking_steps", "id = ?2"),
            ("search_decisions", "id = ?2"),
            ("code_executions", "id = ?2"),
            ("content_blocks", "id = ?2"),
            ("message_contexts", "message_id = ?2"),
            ("message_attachments", "message_id = ?2"),
            ("conversation_settings", "conversation_id = ?2"),
            ("conversation_participants", "id = ?2"),
            ("models", "id = ?2"),
            ("files", "id = ?2"),
            ("assistant_tools", "assistant_id = ?2"),
            ("assistant_skills", "assistant_id = ?2"),
            ("assistant_knowledge_bases", "assistant_id = ?2"),
        ];
        for (table, where_clause) in cases {
            let sql = tombstone_update(table, where_clause);
            sqlx::query(&sql)
                .fetch_all(&pool)
                .await
                .unwrap_or_else(|e| panic!("{table}: {e} — {sql}"));
        }
    }

    /// A wiped tombstone keeps identity columns and blanks payload.
    #[tokio::test]
    async fn tombstone_wipes_payload_but_keeps_identity() {
        let pool = canonical_pool().await;
        let now = "2026-08-24T12:00:00+00:00";
        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at) \
             VALUES ('c1','t','2026-01-01','')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO messages (id, conversation_id, sender_type, content, created_at, updated_at) \
             VALUES ('m1','c1','user','hi','2026-01-01','')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO tool_calls (id, message_id, tool_name, tool_input, tool_output, status, created_at, updated_at) \
             VALUES ('tc1','m1','web_fetch','{}','enormous output','completed','2026-01-01','')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(&tombstone_update("tool_calls", "id = ?2"))
            .bind(now)
            .bind("tc1")
            .execute(&pool)
            .await
            .unwrap();
        let (name, input, output, deleted): (String, Option<String>, Option<String>, String) =
            sqlx::query_as(
                "SELECT tool_name, tool_input, tool_output, deleted_at FROM tool_calls WHERE id = 'tc1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "web_fetch"); // identity column survives
        assert!(input.is_none() && output.is_none()); // payload wiped
        assert_eq!(deleted, now);
    }
}
