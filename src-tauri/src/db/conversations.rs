use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{
    Conversation, ConversationParticipant, CreateConversationParticipantRequest,
    CreateConversationRequest, Message, ParticipantSummary,
};

impl Database {
    // Conversation CRUD operations
    pub async fn create_conversation(
        &self,
        req: CreateConversationRequest,
    ) -> Result<Conversation> {
        let id = match req.id {
            Some(id) => {
                let parsed = Uuid::parse_str(&id)
                    .map_err(|e| anyhow::anyhow!("Invalid conversation id {id}: {e}"))?;
                anyhow::ensure!(
                    parsed.get_version_num() == 7,
                    "Conversation id {id} is not a UUID v7"
                );
                parsed.to_string()
            }
            None => Uuid::now_v7().to_string(),
        };
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO conversations (id, title, created_at, updated_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.title)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_conversation(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created conversation"))
    }

    pub async fn get_conversation(&self, id: &str) -> Result<Option<Conversation>> {
        let row = sqlx::query(
            "SELECT 
                c.id, 
                c.title, 
                c.created_at, 
                c.updated_at,
                c.active_message_id,
                COALESCE(
                    (SELECT m.content FROM messages m
                     WHERE m.id = c.active_message_id
                       AND m.conversation_id = c.id AND m.deleted_at IS NULL),
                    (SELECT m.content FROM messages m
                     WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                     ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
                ) as last_message
             FROM conversations c 
             WHERE c.id = ? AND c.deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(Some(Conversation {
                id: row.get("id"),
                title: row.get("title"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                active_message_id: row.get("active_message_id"),
                last_message: row.get("last_message"),
            })),
            None => Ok(None),
        }
    }

    pub async fn list_conversations(&self) -> Result<Vec<Conversation>> {
        let rows = sqlx::query(
            "SELECT 
                c.id, 
                c.title, 
                c.created_at, 
                c.updated_at,
                c.active_message_id,
                COALESCE(
                    (SELECT m.content FROM messages m
                     WHERE m.id = c.active_message_id
                       AND m.conversation_id = c.id AND m.deleted_at IS NULL),
                    (SELECT m.content FROM messages m
                     WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                     ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
                ) as last_message
             FROM conversations c 
             WHERE c.deleted_at IS NULL
             ORDER BY c.updated_at DESC",
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let conversations = rows
            .iter()
            .map(|row| Conversation {
                id: row.get("id"),
                title: row.get("title"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                active_message_id: row.get("active_message_id"),
                last_message: row.get("last_message"),
            })
            .collect();

        Ok(conversations)
    }

    pub async fn update_conversation(&self, id: &str, title: &str) -> Result<Conversation> {
        let now = Utc::now().to_rfc3339();

        sqlx::query("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        self.get_conversation(id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Conversation not found"))
    }

    /// Soft-delete (ADR 01): hard DELETEs cannot propagate through the
    /// append-only snapshot merge, so deletion is a tombstone row update.
    /// Child messages keep their rows; reads filter tombstoned conversations.
    /// Soft-delete the conversation and every row it owns. Messages and
    /// their child rows (tool outputs dominate the bulk) are wiped
    /// tombstones too, so a deleted conversation actually reclaims snapshot
    /// space instead of shipping dead payload forever.
    pub async fn delete_conversation(&self, id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("DELETE FROM messages_fts WHERE conversation_id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        crate::db::soft_delete::tombstone_children_of_messages(
            self.pool.as_ref(),
            "conversation_id = ?",
            &[id],
        )
        .await?;
        for (table, where_clause) in [
            ("messages", "conversation_id = ?2 AND deleted_at IS NULL"),
            ("conversation_settings", "conversation_id = ?2"),
            ("conversation_participants", "conversation_id = ?2"),
            ("conversations", "id = ?2"),
        ] {
            sqlx::query(&crate::db::soft_delete::tombstone_update(
                table,
                where_clause,
            ))
            .bind(&now)
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        }
        Ok(())
    }

    // Conversation Participant operations
    pub async fn add_conversation_participant(
        &self,
        req: CreateConversationParticipantRequest,
    ) -> Result<ConversationParticipant> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO conversation_participants 
             (id, conversation_id, participant_type, participant_id, display_name, role, status, joined_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'member', 'active', ?, ?)"
        )
        .bind(&id)
        .bind(&req.conversation_id)
        .bind(&req.participant_type)
        .bind(&req.participant_id)
        .bind(&req.display_name)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_conversation_participant(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created participant"))
    }

    pub async fn get_conversation_participant(
        &self,
        id: &str,
    ) -> Result<Option<ConversationParticipant>> {
        let row = sqlx::query(
            "SELECT id, conversation_id, participant_type, participant_id, display_name, 
             role, status, joined_at, left_at, last_read_at, metadata
             FROM conversation_participants WHERE conversation_participants.deleted_at IS NULL AND id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => Ok(Some(ConversationParticipant {
                id: row.get("id"),
                conversation_id: row.get("conversation_id"),
                participant_type: row.get("participant_type"),
                participant_id: row.get("participant_id"),
                display_name: row.get("display_name"),
                role: row.get("role"),
                status: row.get("status"),
                joined_at: row.get("joined_at"),
                left_at: row.get("left_at"),
                last_read_at: row.get("last_read_at"),
                metadata: row.get("metadata"),
            })),
            None => Ok(None),
        }
    }

    pub async fn list_conversation_participants(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationParticipant>> {
        let rows = sqlx::query(
            "SELECT id, conversation_id, participant_type, participant_id, display_name, 
             role, status, joined_at, left_at, last_read_at, metadata
             FROM conversation_participants WHERE conversation_participants.deleted_at IS NULL AND conversation_id = ? ORDER BY joined_at",
        )
        .bind(conversation_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let participants = rows
            .iter()
            .map(|row| ConversationParticipant {
                id: row.get("id"),
                conversation_id: row.get("conversation_id"),
                participant_type: row.get("participant_type"),
                participant_id: row.get("participant_id"),
                display_name: row.get("display_name"),
                role: row.get("role"),
                status: row.get("status"),
                joined_at: row.get("joined_at"),
                left_at: row.get("left_at"),
                last_read_at: row.get("last_read_at"),
                metadata: row.get("metadata"),
            })
            .collect();

        Ok(participants)
    }

    pub async fn get_conversation_participant_summary(
        &self,
        conversation_id: &str,
        current_user_id: &str,
    ) -> Result<Vec<ParticipantSummary>> {
        let rows = sqlx::query(
            "SELECT DISTINCT
                cp.participant_type,
                cp.participant_id,
                COALESCE(cp.display_name, u.display_name, a.name, m.name, 'Unknown') as display_name,
                COALESCE(
                    CASE cp.participant_type
                        WHEN 'user' THEN u.avatar_type
                        WHEN 'assistant' THEN a.avatar_type
                        ELSE 'text'
                    END, 'text'
                ) as avatar_type,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_bg
                    WHEN 'assistant' THEN a.avatar_bg
                    ELSE NULL
                END as avatar_bg,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_text
                    WHEN 'assistant' THEN a.avatar_text
                    ELSE NULL
                END as avatar_text,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_image_path
                    WHEN 'assistant' THEN a.avatar_image_path
                    ELSE NULL
                END as avatar_image_path,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_image_url
                    WHEN 'assistant' THEN a.avatar_image_url
                    ELSE NULL
                END as avatar_image_url
             FROM conversation_participants cp
             LEFT JOIN users u ON cp.participant_type = 'user' AND cp.participant_id = u.id
             LEFT JOIN assistants a ON cp.participant_type = 'assistant' AND cp.participant_id = a.id
             LEFT JOIN models m ON cp.participant_type = 'model' AND cp.participant_id = m.id
             WHERE cp.deleted_at IS NULL AND a.deleted_at IS NULL AND cp.conversation_id = ? 
               AND cp.status = 'active'
               AND NOT (cp.participant_type = 'user' AND cp.participant_id = ?)
             ORDER BY cp.joined_at"
        )
        .bind(conversation_id)
        .bind(current_user_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let summaries = rows
            .iter()
            .map(|row| ParticipantSummary {
                participant_type: row.get("participant_type"),
                participant_id: row.get("participant_id"),
                display_name: row.get("display_name"),
                avatar_type: row.get("avatar_type"),
                avatar_bg: row.get("avatar_bg"),
                avatar_text: row.get("avatar_text"),
                avatar_image_path: row.get("avatar_image_path"),
                avatar_image_url: row.get("avatar_image_url"),
            })
            .collect();

        Ok(summaries)
    }

    pub async fn remove_conversation_participant(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "conversation_participants",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    /// Fork a conversation: create a new conversation holding the ANCESTOR
    /// PATH of `up_to_message_id` (root -> target), with the full per-message
    /// record set (steps, tool calls, search/fetch context, attachments) so
    /// the fork remains a complete, continuable conversation. The copied
    /// target becomes the new conversation's active leaf.
    pub async fn fork_conversation(
        &self,
        source_conversation_id: &str,
        up_to_message_id: &str,
    ) -> Result<Conversation> {
        let source = self
            .get_conversation(source_conversation_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Source conversation not found"))?;

        let target_message = self
            .get_message(up_to_message_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Target message not found"))?;
        if target_message.conversation_id.as_deref() != Some(source_conversation_id) {
            anyhow::bail!(
                "Message {up_to_message_id} does not belong to conversation {source_conversation_id}"
            );
        }

        // Ancestor chain root -> target (tree prefix; off-branch siblings
        // and later turns stay behind).
        let mut chain: Vec<Message> = vec![target_message.clone()];
        let mut cursor = target_message.parent_id.clone();
        while let Some(parent_id) = cursor {
            let parent = self
                .get_message(&parent_id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("Broken parent chain at {parent_id}"))?;
            cursor = parent.parent_id.clone();
            chain.push(parent);
        }
        chain.reverse();

        let new_conv = self
            .create_conversation(CreateConversationRequest {
                id: None,
                title: source.title.clone(),
            })
            .await?;

        let now = Utc::now().to_rfc3339();
        let mut id_map: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut new_tail: Option<String> = None;

        for msg in &chain {
            let new_msg_id = Uuid::now_v7().to_string();
            let new_parent_id = msg.parent_id.as_ref().and_then(|p| id_map.get(p));
            sqlx::query(
                "INSERT INTO messages (id, conversation_id, parent_id, sender_type, sender_id, content, tokens, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&new_msg_id)
            .bind(&new_conv.id)
            .bind(&new_parent_id)
            .bind(&msg.sender_type)
            .bind(&msg.sender_id)
            .bind(&msg.content)
            .bind(msg.tokens)
            .bind(&msg.created_at)
            .bind(&now)
            .execute(self.pool.as_ref())
            .await?;

            id_map.insert(msg.id.clone(), new_msg_id.clone());
            new_tail = Some(new_msg_id.clone());

            self.copy_message_children(&msg.id, &new_msg_id, &now)
                .await?;
        }

        if let Some(tail) = new_tail {
            sqlx::query(
                "UPDATE conversations SET active_message_id = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&tail)
            .bind(&now)
            .bind(&new_conv.id)
            .execute(self.pool.as_ref())
            .await?;
        }

        let participants = self
            .list_conversation_participants(source_conversation_id)
            .await?;
        for p in &participants {
            self.add_conversation_participant(CreateConversationParticipantRequest {
                conversation_id: new_conv.id.clone(),
                participant_type: p.participant_type.clone(),
                participant_id: p.participant_id.clone(),
                display_name: p.display_name.clone(),
            })
            .await?;
        }

        let settings = self
            .get_conversation_settings(source_conversation_id)
            .await?;
        let param_json = serde_json::to_string(&settings.parameter_overrides)?;
        let mcp_json = serde_json::to_string(&settings.enabled_mcp_server_ids)?;
        let skill_json = serde_json::to_string(&settings.enabled_skill_ids)?;
        sqlx::query(
            "INSERT INTO conversation_settings (
                conversation_id, use_provider_defaults, use_custom_parameters,
                parameter_overrides, context_message_count, selected_preset_id,
                system_prompt_mode, selected_system_prompt_id, custom_system_prompt,
                user_prompt_mode, selected_user_prompt_id, custom_user_prompt,
                enabled_mcp_server_ids, enabled_skill_ids, working_directory,
                permission_mode, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                use_provider_defaults = excluded.use_provider_defaults,
                use_custom_parameters = excluded.use_custom_parameters,
                parameter_overrides = excluded.parameter_overrides,
                context_message_count = excluded.context_message_count,
                selected_preset_id = excluded.selected_preset_id,
                system_prompt_mode = excluded.system_prompt_mode,
                selected_system_prompt_id = excluded.selected_system_prompt_id,
                custom_system_prompt = excluded.custom_system_prompt,
                user_prompt_mode = excluded.user_prompt_mode,
                selected_user_prompt_id = excluded.selected_user_prompt_id,
                custom_user_prompt = excluded.custom_user_prompt,
                enabled_mcp_server_ids = excluded.enabled_mcp_server_ids,
                enabled_skill_ids = excluded.enabled_skill_ids,
                working_directory = excluded.working_directory,
                permission_mode = excluded.permission_mode,
                updated_at = excluded.updated_at",
        )
        .bind(&new_conv.id)
        .bind(settings.use_provider_defaults as i32)
        .bind(settings.use_custom_parameters as i32)
        .bind(&param_json)
        .bind(settings.context_message_count)
        .bind(&settings.selected_preset_id)
        .bind(String::from(settings.system_prompt_mode))
        .bind(&settings.selected_system_prompt_id)
        .bind(&settings.custom_system_prompt)
        .bind(String::from(settings.user_prompt_mode))
        .bind(&settings.selected_user_prompt_id)
        .bind(&settings.custom_user_prompt)
        .bind(&mcp_json)
        .bind(&skill_json)
        .bind(&settings.working_directory)
        .bind(settings.permission_mode.as_str())
        .bind(Utc::now().to_rfc3339())
        .execute(self.pool.as_ref())
        .await?;
        // The copy path raw-INSERTs messages, bypassing create_message's
        // FTS maintenance; reconcile so the fork is searchable immediately
        // instead of waiting for the next sync pull.
        self.sync_fts_incremental().await?;

        self.get_conversation(&new_conv.id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve forked conversation"))
    }

    /// Copy every live per-message child row (thinking steps, tool calls,
    /// code executions, content blocks, search results + decisions, fetch
    /// contexts, file attachments) from `old_message_id` to `new_message_id`.
    /// Shared parents (files, fetch_results) are reused; only message-keyed
    /// rows and junctions are duplicated. Returns the search_results id
    /// remap (old -> new) so dependent rows can be re-linked.
    async fn copy_message_children(
        &self,
        old_message_id: &str,
        new_message_id: &str,
        now: &str,
    ) -> Result<()> {
        let mut search_result_remap: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        // search_results first: search_decisions reference them by id.
        let search_rows = sqlx::query(
            "SELECT id, query, engine, total_results, display_order, searched_at, items_json
             FROM search_results WHERE message_id = ? AND deleted_at IS NULL",
        )
        .bind(old_message_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        for row in &search_rows {
            let old_id: String = row.get("id");
            let new_id = Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO search_results
                    (id, message_id, query, engine, total_results, display_order, searched_at, items_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&new_id)
            .bind(new_message_id)
            .bind::<String>(row.get("query"))
            .bind::<String>(row.get("engine"))
            .bind(row.try_get("total_results").unwrap_or(None::<i64>))
            .bind(row.try_get("display_order").unwrap_or(0))
            .bind::<String>(row.get("searched_at"))
            .bind(row.try_get("items_json").unwrap_or(None::<String>))
            .bind(now)
            .execute(self.pool.as_ref())
            .await?;
            search_result_remap.insert(old_id, new_id);
        }

        let decision_rows = sqlx::query(
            "SELECT reasoning, search_needed, search_query, search_result_id, display_order
             FROM search_decisions WHERE message_id = ? AND deleted_at IS NULL
             ORDER BY display_order, created_at",
        )
        .bind(old_message_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        for row in &decision_rows {
            let old_search_id: Option<String> = row.get("search_result_id");
            sqlx::query(
                "INSERT INTO search_decisions
                    (id, message_id, reasoning, search_needed, search_query, search_result_id, display_order, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(new_message_id)
            .bind::<String>(row.get("reasoning"))
            .bind(row.try_get::<i64, _>("search_needed").unwrap_or(0))
            .bind(row.try_get::<Option<String>, _>("search_query").unwrap_or(None))
            .bind(old_search_id.as_ref().and_then(|id| search_result_remap.get(id)))
            .bind(row.try_get("display_order").unwrap_or(0))
            .bind(now)
            .execute(self.pool.as_ref())
            .await?;
        }

        let thinking_rows = sqlx::query(
            "SELECT content, source, display_order
             FROM thinking_steps WHERE message_id = ? AND deleted_at IS NULL
             ORDER BY display_order, created_at",
        )
        .bind(old_message_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        for row in &thinking_rows {
            sqlx::query(
                "INSERT INTO thinking_steps (id, message_id, content, source, display_order, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(new_message_id)
            .bind::<String>(row.get("content"))
            .bind(row.try_get::<Option<String>, _>("source").unwrap_or(None))
            .bind(row.try_get("display_order").unwrap_or(0))
            .bind(now)
            .execute(self.pool.as_ref())
            .await?;
        }

        let tool_rows = sqlx::query(
            "SELECT call_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, completed_at
             FROM tool_calls WHERE message_id = ? AND deleted_at IS NULL
             ORDER BY display_order, created_at",
        )
        .bind(old_message_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        for row in &tool_rows {
            sqlx::query(
                "INSERT INTO tool_calls
                    (id, call_id, message_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, created_at, completed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(row.try_get::<Option<String>, _>("call_id").unwrap_or(None))
            .bind(new_message_id)
            .bind::<String>(row.get("tool_name"))
            .bind(row.try_get::<Option<String>, _>("tool_input").unwrap_or(None))
            .bind(row.try_get::<Option<String>, _>("tool_output").unwrap_or(None))
            .bind(row.try_get::<Option<String>, _>("status").unwrap_or(None))
            .bind(row.try_get::<Option<String>, _>("error").unwrap_or(None))
            .bind(row.try_get::<Option<i64>, _>("duration_ms").unwrap_or(None))
            .bind(row.try_get("display_order").unwrap_or(0))
            .bind(now)
            .bind(row.try_get::<Option<String>, _>("completed_at").unwrap_or(None))
            .execute(self.pool.as_ref())
            .await?;
        }

        let exec_rows = sqlx::query(
            "SELECT language, code, output, exit_code, status, error, duration_ms, display_order, completed_at
             FROM code_executions WHERE message_id = ? AND deleted_at IS NULL
             ORDER BY display_order, created_at",
        )
        .bind(old_message_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        for row in &exec_rows {
            sqlx::query(
                "INSERT INTO code_executions
                    (id, message_id, language, code, output, exit_code, status, error, duration_ms, display_order, created_at, completed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(new_message_id)
            .bind::<String>(row.get("language"))
            .bind::<String>(row.get("code"))
            .bind(row.try_get::<Option<String>, _>("output").unwrap_or(None))
            .bind(row.try_get::<Option<i64>, _>("exit_code").unwrap_or(None))
            .bind(row.try_get::<Option<String>, _>("status").unwrap_or(None))
            .bind(row.try_get::<Option<String>, _>("error").unwrap_or(None))
            .bind(row.try_get::<Option<i64>, _>("duration_ms").unwrap_or(None))
            .bind(row.try_get("display_order").unwrap_or(0))
            .bind(now)
            .bind(row.try_get::<Option<String>, _>("completed_at").unwrap_or(None))
            .execute(self.pool.as_ref())
            .await?;
        }

        let block_rows = sqlx::query(
            "SELECT content, display_order
             FROM content_blocks WHERE message_id = ? AND deleted_at IS NULL
             ORDER BY display_order, created_at",
        )
        .bind(old_message_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        for row in &block_rows {
            sqlx::query(
                "INSERT INTO content_blocks (id, message_id, content, display_order, created_at)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(new_message_id)
            .bind::<String>(row.get("content"))
            .bind(row.try_get::<i64, _>("display_order").unwrap_or(0))
            .bind(now)
            .execute(self.pool.as_ref())
            .await?;
        }

        // Junction rows: shared targets (files, fetch_results) are reused,
        // only the link is duplicated.
        let context_rows = sqlx::query(
            "SELECT context_type, context_id, display_order
             FROM message_contexts WHERE message_id = ? AND deleted_at IS NULL
             ORDER BY display_order, created_at",
        )
        .bind(old_message_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        for row in &context_rows {
            sqlx::query(
                "INSERT INTO message_contexts
                    (id, message_id, context_type, context_id, display_order, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(new_message_id)
            .bind::<String>(row.get("context_type"))
            .bind::<String>(row.get("context_id"))
            .bind(row.try_get("display_order").unwrap_or(0))
            .bind(now)
            .execute(self.pool.as_ref())
            .await?;
        }

        let attachment_rows = sqlx::query(
            "SELECT attachment_type, attachment_id, display_order
             FROM message_attachments WHERE message_id = ? AND deleted_at IS NULL
             ORDER BY display_order, created_at",
        )
        .bind(old_message_id)
        .fetch_all(self.pool.as_ref())
        .await?;
        for row in &attachment_rows {
            sqlx::query(
                "INSERT INTO message_attachments
                    (id, message_id, attachment_type, attachment_id, display_order, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(new_message_id)
            .bind::<String>(row.get("attachment_type"))
            .bind::<String>(row.get("attachment_id"))
            .bind(row.try_get("display_order").unwrap_or(0))
            .bind(now)
            .execute(self.pool.as_ref())
            .await?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        CreateFileAttachmentRequest, CreateMessageRequest, CreateModelParameterPresetRequest,
        CreatePromptRequest, CreateUserRequest, Message, ModelParameterOverrides, PermissionMode,
        PromptMode, UpdateConversationSettingsRequest,
    };

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    async fn new_conversation(db: &Database, title: &str) -> Conversation {
        db.create_conversation(CreateConversationRequest {
            id: None,
            title: title.to_string(),
        })
        .await
        .unwrap()
    }

    async fn add_message(db: &Database, conversation_id: &str, content: &str) -> Message {
        db.create_message(CreateMessageRequest {
            conversation_id: Some(conversation_id.to_string()),
            parent_id: None,
            sender_type: "user".to_string(),
            sender_id: None,
            content: content.to_string(),
            tokens: Some(content.len() as i64),
        })
        .await
        .unwrap()
    }

    /// Insert a message with a fixed timestamp, bypassing `create_message`,
    /// so fork boundary ordering is deterministic. Tree placement mirrors
    /// `create_message`: appends under the current active leaf, then moves
    /// the leaf onto the new row.
    async fn insert_message_at(
        db: &Database,
        conversation_id: &str,
        id: &str,
        content: &str,
        tokens: i64,
        created_at: &str,
    ) {
        let (parent_id,): (Option<String>,) = sqlx::query_as(
            "SELECT active_message_id FROM conversations WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(conversation_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO messages (id, conversation_id, parent_id, sender_type, sender_id, content, tokens, created_at, updated_at) \
             VALUES (?, ?, ?, 'user', NULL, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(conversation_id)
        .bind(&parent_id)
        .bind(content)
        .bind(tokens)
        .bind(created_at)
        .bind(created_at)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query("UPDATE conversations SET active_message_id = ? WHERE id = ?")
            .bind(id)
            .bind(conversation_id)
            .execute(db.pool())
            .await
            .unwrap();
    }

    async fn add_user_participant(
        db: &Database,
        conversation_id: &str,
        participant_id: &str,
        display_name: Option<&str>,
    ) -> ConversationParticipant {
        db.add_conversation_participant(CreateConversationParticipantRequest {
            conversation_id: conversation_id.to_string(),
            participant_type: "user".to_string(),
            participant_id: Some(participant_id.to_string()),
            display_name: display_name.map(|s| s.to_string()),
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn create_conversation_keeps_a_client_uuid_v7() {
        let (db, _dir) = test_db().await;
        let id = Uuid::now_v7().to_string();

        let created = db
            .create_conversation(CreateConversationRequest {
                id: Some(id.clone()),
                title: String::new(),
            })
            .await
            .unwrap();

        assert_eq!(created.id, id);
    }

    #[tokio::test]
    async fn create_conversation_rejects_ids_that_are_not_uuid_v7() {
        let (db, _dir) = test_db().await;

        // The second is a valid UUID, but version 4
        for id in ["not-a-uuid", "9b2e4c1a-3f6d-4a8b-9c0d-1e2f3a4b5c6d"] {
            let result = db
                .create_conversation(CreateConversationRequest {
                    id: Some(id.to_string()),
                    title: String::new(),
                })
                .await;
            assert!(result.is_err(), "accepted {id}");
        }
    }

    #[tokio::test]
    async fn create_conversation_round_trips() {
        let (db, _dir) = test_db().await;
        let created = new_conversation(&db, "first chat").await;

        assert!(!created.id.is_empty());
        assert!(!created.created_at.is_empty());
        assert!(!created.updated_at.is_empty());
        assert_eq!(created.last_message, None);

        let fetched = db.get_conversation(&created.id).await.unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.title, "first chat");
        assert_eq!(fetched.created_at, created.created_at);
        assert_eq!(fetched.updated_at, created.updated_at);

        let other = new_conversation(&db, "second chat").await;
        assert_ne!(other.id, created.id);
    }

    #[tokio::test]
    async fn get_conversation_returns_none_for_unknown_id() {
        let (db, _dir) = test_db().await;
        assert!(
            db.get_conversation(&Uuid::now_v7().to_string())
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn list_conversations_orders_by_most_recently_updated_desc() {
        let (db, _dir) = test_db().await;
        assert!(db.list_conversations().await.unwrap().is_empty());

        let a = new_conversation(&db, "alpha").await;
        let _b = new_conversation(&db, "beta").await;

        fn titles(convs: &[Conversation]) -> Vec<&str> {
            convs.iter().map(|c| c.title.as_str()).collect()
        }
        assert_eq!(
            titles(&db.list_conversations().await.unwrap()),
            ["beta", "alpha"]
        );

        // Updating alpha bumps its updated_at past beta's creation.
        db.update_conversation(&a.id, "alpha redux").await.unwrap();
        assert_eq!(
            titles(&db.list_conversations().await.unwrap()),
            ["alpha redux", "beta"]
        );
    }

    #[tokio::test]
    async fn update_conversation_retitles_and_rejects_unknown_id() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "old title").await;

        let updated = db.update_conversation(&conv.id, "new title").await.unwrap();
        assert_eq!(updated.id, conv.id);
        assert_eq!(updated.title, "new title");
        assert_eq!(
            db.get_conversation(&conv.id).await.unwrap().unwrap().title,
            "new title"
        );

        let missing = Uuid::now_v7().to_string();
        assert!(db.update_conversation(&missing, "x").await.is_err());
    }

    #[tokio::test]
    async fn last_message_tracks_latest_live_message() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "chatter").await;
        assert_eq!(
            db.get_conversation(&conv.id)
                .await
                .unwrap()
                .unwrap()
                .last_message,
            None
        );

        add_message(&db, &conv.id, "hello").await;
        let second = add_message(&db, &conv.id, "world").await;
        assert_eq!(
            db.get_conversation(&conv.id)
                .await
                .unwrap()
                .unwrap()
                .last_message
                .as_deref(),
            Some("world")
        );

        // Tombstoning the tail falls back to the previous live message.
        db.delete_messages_from(&conv.id, &second.id).await.unwrap();
        assert_eq!(
            db.get_conversation(&conv.id)
                .await
                .unwrap()
                .unwrap()
                .last_message
                .as_deref(),
            Some("hello")
        );
    }

    #[tokio::test]
    async fn last_message_follows_active_branch() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "branchy").await;

        let u1 = add_message(&db, &conv.id, "q1").await;
        let _a1 = db
            .create_message(CreateMessageRequest {
                conversation_id: Some(conv.id.clone()),
                parent_id: Some(u1.id.clone()),
                sender_type: "assistant".to_string(),
                sender_id: None,
                content: "old answer".to_string(),
                tokens: None,
            })
            .await
            .unwrap();
        // Resend shape: a sibling first-turn variant under the root sentinel.
        db.create_message(CreateMessageRequest {
            conversation_id: Some(conv.id.clone()),
            parent_id: Some(String::new()),
            sender_type: "user".to_string(),
            sender_id: None,
            content: "q1 resent".to_string(),
            tokens: None,
        })
        .await
        .unwrap();
        add_message(&db, &conv.id, "new answer").await;

        // Active branch tip is the newest line...
        assert_eq!(
            db.get_conversation(&conv.id)
                .await
                .unwrap()
                .unwrap()
                .last_message
                .as_deref(),
            Some("new answer")
        );

        // ...and switching back moves the preview with the branch instead
        // of showing the abandoned (chronologically newest) tail.
        db.set_active_message(&conv.id, &u1.id).await.unwrap();
        assert_eq!(
            db.get_conversation(&conv.id)
                .await
                .unwrap()
                .unwrap()
                .last_message
                .as_deref(),
            Some("old answer")
        );
    }

    #[tokio::test]
    async fn forked_messages_are_fts_searchable_immediately() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "src").await;
        let msg = add_message(&db, &conv.id, "xylophone query").await;

        let forked = db.fork_conversation(&conv.id, &msg.id).await.unwrap();

        // The copy path bypasses create_message; without the reconcile the
        // fork would stay invisible to search until the next sync pull.
        let hits = db.search_messages("xylophone", 10, 0).await.unwrap();
        assert!(
            hits.iter().any(|h| h.conversation_id == forked.id),
            "forked conversation missing from FTS hits: {hits:?}"
        );
    }

    #[tokio::test]
    async fn delete_conversation_hides_itself_messages_and_participants() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "doomed").await;
        let msg = add_message(&db, &conv.id, "last words").await;
        let participant = add_user_participant(&db, &conv.id, "u-1", Some("U1")).await;

        db.delete_conversation(&conv.id).await.unwrap();

        assert!(db.get_conversation(&conv.id).await.unwrap().is_none());
        assert!(
            !db.list_conversations()
                .await
                .unwrap()
                .iter()
                .any(|c| c.id == conv.id)
        );
        assert!(
            db.get_conversation_participant(&participant.id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            db.list_conversation_participants(&conv.id)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            db.list_messages_by_conversation(&conv.id, None, None)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(db.get_message(&msg.id).await.unwrap().is_none());

        // Soft delete (ADR 01): the message row is tombstoned, not dropped.
        let tombstoned: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND deleted_at IS NOT NULL",
        )
        .bind(&conv.id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(tombstoned, 1);
    }

    #[tokio::test]
    async fn add_conversation_participant_round_trips_with_defaults() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "party").await;

        let p = add_user_participant(&db, &conv.id, "user-42", Some("Carol")).await;
        assert_eq!(p.conversation_id, conv.id);
        assert_eq!(p.participant_type, "user");
        assert_eq!(p.participant_id.as_deref(), Some("user-42"));
        assert_eq!(p.display_name.as_deref(), Some("Carol"));
        assert_eq!(p.role, "member");
        assert_eq!(p.status, "active");
        assert!(!p.joined_at.is_empty());
        assert_eq!(p.left_at, None);
        assert_eq!(p.last_read_at, None);
        assert_eq!(p.metadata, None);

        let fetched = db
            .get_conversation_participant(&p.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(fetched.id, p.id);
        assert_eq!(fetched.participant_id, p.participant_id);
        assert_eq!(fetched.display_name, p.display_name);
        assert_eq!(fetched.role, "member");
        assert_eq!(fetched.status, "active");
        assert_eq!(fetched.joined_at, p.joined_at);
    }

    #[tokio::test]
    async fn get_conversation_participant_returns_none_for_unknown_id() {
        let (db, _dir) = test_db().await;
        assert!(
            db.get_conversation_participant(&Uuid::now_v7().to_string())
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn list_participants_preserves_join_order_and_drops_removed() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "roster").await;

        let p1 = add_user_participant(&db, &conv.id, "u1", Some("One")).await;
        let p2 = db
            .add_conversation_participant(CreateConversationParticipantRequest {
                conversation_id: conv.id.clone(),
                participant_type: "model".to_string(),
                participant_id: Some("m1".to_string()),
                display_name: Some("Model One".to_string()),
            })
            .await
            .unwrap();
        let p3 = add_user_participant(&db, &conv.id, "u3", Some("Three")).await;

        fn ids(ps: &[ConversationParticipant]) -> Vec<&str> {
            ps.iter().map(|p| p.id.as_str()).collect()
        }
        let listed = db.list_conversation_participants(&conv.id).await.unwrap();
        assert_eq!(
            ids(&listed),
            [p1.id.as_str(), p2.id.as_str(), p3.id.as_str()]
        );

        // Other conversations see none of these participants.
        let other = new_conversation(&db, "empty").await;
        assert!(
            db.list_conversation_participants(&other.id)
                .await
                .unwrap()
                .is_empty()
        );

        db.remove_conversation_participant(&p2.id).await.unwrap();
        assert!(
            db.get_conversation_participant(&p2.id)
                .await
                .unwrap()
                .is_none()
        );
        let listed = db.list_conversation_participants(&conv.id).await.unwrap();
        assert_eq!(ids(&listed), [p1.id.as_str(), p3.id.as_str()]);
    }

    #[tokio::test]
    async fn remove_participant_tolerates_unknown_and_repeat_calls() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "leavers").await;
        let p = add_user_participant(&db, &conv.id, "u9", None).await;

        db.remove_conversation_participant(&p.id).await.unwrap();
        assert!(
            db.get_conversation_participant(&p.id)
                .await
                .unwrap()
                .is_none(),
            "removed participant must vanish from reads"
        );
        // Already tombstoned, then a never-existing id: both stay Ok no-ops.
        db.remove_conversation_participant(&p.id).await.unwrap();
        db.remove_conversation_participant(&Uuid::now_v7().to_string())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn participant_summary_resolves_identity_and_excludes_current_user() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "summit").await;

        let alice = db
            .create_user(CreateUserRequest {
                username: "alice".to_string(),
                display_name: "Alice".to_string(),
                email: Some("alice@example.com".to_string()),
                avatar_type: Some("color".to_string()),
                avatar_bg: Some("#ff0000".to_string()),
                avatar_text: Some("AL".to_string()),
                avatar_image_path: None,
                avatar_image_url: None,
                is_self: Some(false),
            })
            .await
            .unwrap();
        let bob = db
            .create_user(CreateUserRequest {
                username: "bob".to_string(),
                display_name: "Bob".to_string(),
                email: None,
                avatar_type: None,
                avatar_bg: None,
                avatar_text: None,
                avatar_image_path: None,
                avatar_image_url: None,
                is_self: None,
            })
            .await
            .unwrap();

        add_user_participant(&db, &conv.id, &alice.id, None).await;
        add_user_participant(&db, &conv.id, &bob.id, None).await;
        db.add_conversation_participant(CreateConversationParticipantRequest {
            conversation_id: conv.id.clone(),
            participant_type: "model".to_string(),
            participant_id: Some("known-model".to_string()),
            display_name: Some("Helper Model".to_string()),
        })
        .await
        .unwrap();
        db.add_conversation_participant(CreateConversationParticipantRequest {
            conversation_id: conv.id.clone(),
            participant_type: "model".to_string(),
            participant_id: Some(Uuid::now_v7().to_string()),
            display_name: None,
        })
        .await
        .unwrap();

        // Viewed as Alice: she is excluded; the rest resolve in join order.
        let summaries = db
            .get_conversation_participant_summary(&conv.id, &alice.id)
            .await
            .unwrap();
        assert_eq!(summaries.len(), 3);

        assert_eq!(summaries[0].participant_type, "user");
        assert_eq!(
            summaries[0].participant_id.as_deref(),
            Some(bob.id.as_str())
        );
        assert_eq!(summaries[0].display_name, "Bob");
        assert_eq!(summaries[0].avatar_type, "text");
        assert_eq!(summaries[0].avatar_bg, None);

        assert_eq!(summaries[1].participant_type, "model");
        assert_eq!(summaries[1].display_name, "Helper Model");
        assert_eq!(summaries[1].avatar_type, "text");
        assert_eq!(summaries[1].avatar_image_url, None);

        // Unresolvable model with no display name falls back to "Unknown".
        assert_eq!(summaries[2].participant_type, "model");
        assert_eq!(summaries[2].display_name, "Unknown");
        assert_eq!(summaries[2].avatar_type, "text");

        // Viewed as an outsider: Alice is listed and her user profile
        // supplies display name and avatar fields.
        let summaries = db
            .get_conversation_participant_summary(&conv.id, "someone-else")
            .await
            .unwrap();
        assert_eq!(summaries.len(), 4);
        assert_eq!(
            summaries[0].participant_id.as_deref(),
            Some(alice.id.as_str())
        );
        assert_eq!(summaries[0].display_name, "Alice");
        assert_eq!(summaries[0].avatar_type, "color");
        assert_eq!(summaries[0].avatar_bg.as_deref(), Some("#ff0000"));
        assert_eq!(summaries[0].avatar_text.as_deref(), Some("AL"));
    }

    #[tokio::test]
    async fn fork_conversation_errors_for_missing_source_or_target_message() {
        let (db, _dir) = test_db().await;
        let missing = Uuid::now_v7().to_string();

        assert!(db.fork_conversation(&missing, &missing).await.is_err());

        let conv = new_conversation(&db, "src").await;
        assert!(db.fork_conversation(&conv.id, &missing).await.is_err());

        // A tombstoned source is invisible to the fork path too.
        let msg = add_message(&db, &conv.id, "hi").await;
        db.delete_conversation(&conv.id).await.unwrap();
        assert!(db.fork_conversation(&conv.id, &msg.id).await.is_err());
    }

    #[tokio::test]
    async fn fork_conversation_copies_messages_up_to_and_including_target() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "fork me").await;

        // m2 and m3 share a timestamp: both must survive the
        // "up to and including" boundary; m4 must not.
        insert_message_at(&db, &conv.id, "m1", "c1", 10, "2026-01-01T00:00:01Z").await;
        insert_message_at(&db, &conv.id, "m2", "c2", 20, "2026-01-01T00:00:02Z").await;
        insert_message_at(&db, &conv.id, "m3", "c3", 30, "2026-01-01T00:00:02Z").await;
        insert_message_at(&db, &conv.id, "m4", "c4", 40, "2026-01-01T00:00:03Z").await;

        let forked = db.fork_conversation(&conv.id, "m3").await.unwrap();

        assert_eq!(forked.title, "fork me");
        assert_ne!(forked.id, conv.id);

        let copied = db
            .list_messages_by_conversation(&forked.id, None, None)
            .await
            .unwrap();
        assert_eq!(
            copied
                .iter()
                .map(|m| m.content.as_str())
                .collect::<Vec<_>>(),
            ["c1", "c2", "c3"]
        );
        assert_eq!(
            copied.iter().map(|m| m.tokens).collect::<Vec<_>>(),
            [Some(10), Some(20), Some(30)]
        );
        assert!(
            copied
                .iter()
                .all(|m| m.conversation_id.as_deref() == Some(forked.id.as_str()))
        );
        assert!(
            copied
                .iter()
                .all(|m| m.id != "m1" && m.id != "m2" && m.id != "m3")
        );

        // The source keeps its full history untouched.
        let source = db
            .list_messages_by_conversation(&conv.id, None, None)
            .await
            .unwrap();
        assert_eq!(source.len(), 4);
    }

    #[tokio::test]
    async fn fork_conversation_copies_participants_and_settings() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "to fork").await;

        let alice = db
            .create_user(CreateUserRequest {
                username: "alice".to_string(),
                display_name: "Alice".to_string(),
                email: None,
                avatar_type: None,
                avatar_bg: None,
                avatar_text: None,
                avatar_image_path: None,
                avatar_image_url: None,
                is_self: Some(false),
            })
            .await
            .unwrap();
        add_user_participant(&db, &conv.id, &alice.id, None).await;
        db.add_conversation_participant(CreateConversationParticipantRequest {
            conversation_id: conv.id.clone(),
            participant_type: "model".to_string(),
            participant_id: Some("model-abc".to_string()),
            display_name: Some("Helper Model".to_string()),
        })
        .await
        .unwrap();

        // selected_preset_id / prompt ids are FK-backed, so real rows are
        // required for the settings upsert to succeed.
        let preset = db
            .create_model_parameter_preset(CreateModelParameterPresetRequest {
                name: "Test Preset".to_string(),
                description: None,
                temperature: Some(0.5),
                max_tokens: None,
                top_p: None,
                frequency_penalty: None,
                presence_penalty: None,
                additional_params: None,
                is_default: None,
            })
            .await
            .unwrap();
        let prompt = db
            .create_prompt(CreatePromptRequest {
                name: "Test Prompt".to_string(),
                content: "do the thing".to_string(),
                description: None,
                category: None,
                is_system: None,
            })
            .await
            .unwrap();

        let source_settings = db
            .update_conversation_settings(
                &conv.id,
                UpdateConversationSettingsRequest {
                    use_provider_defaults: Some(false),
                    use_custom_parameters: Some(true),
                    parameter_overrides: Some(ModelParameterOverrides {
                        temperature: Some(0.7),
                        max_tokens: Some(2048),
                        ..Default::default()
                    }),
                    context_message_count: Some(Some(12)),
                    selected_preset_id: Some(Some(preset.id.clone())),
                    system_prompt_mode: Some(PromptMode::Existing),
                    selected_system_prompt_id: Some(Some(prompt.id.clone())),
                    custom_system_prompt: None,
                    user_prompt_mode: Some(PromptMode::Custom),
                    selected_user_prompt_id: None,
                    custom_user_prompt: Some(Some("reply short".to_string())),
                    enabled_mcp_server_ids: Some(vec!["mcp-a".to_string(), "mcp-b".to_string()]),
                    enabled_skill_ids: Some(vec!["skill-1".to_string()]),
                    working_directory: Some(Some("/tmp/scratch".to_string())),
                    // Non-default mode: the fork must inherit `ask`, not
                    // fall back to the default.
                    permission_mode: Some(PermissionMode::Ask),
                },
            )
            .await
            .unwrap();

        let msg = add_message(&db, &conv.id, "seed turn").await;
        let forked = db.fork_conversation(&conv.id, &msg.id).await.unwrap();

        let participants = db.list_conversation_participants(&forked.id).await.unwrap();
        assert_eq!(participants.len(), 2);
        assert_eq!(participants[0].participant_type, "user");
        assert_eq!(
            participants[0].participant_id.as_deref(),
            Some(alice.id.as_str())
        );
        assert_eq!(participants[1].participant_type, "model");
        assert_eq!(participants[1].participant_id.as_deref(), Some("model-abc"));
        assert_eq!(
            participants[1].display_name.as_deref(),
            Some("Helper Model")
        );

        let forked_settings = db.get_conversation_settings(&forked.id).await.unwrap();
        assert_eq!(forked.id, forked_settings.conversation_id);
        assert_eq!(
            forked_settings.use_provider_defaults,
            source_settings.use_provider_defaults
        );
        assert_eq!(
            forked_settings.use_custom_parameters,
            source_settings.use_custom_parameters
        );
        assert_eq!(
            forked_settings.parameter_overrides.temperature,
            source_settings.parameter_overrides.temperature
        );
        assert_eq!(
            forked_settings.parameter_overrides.max_tokens,
            source_settings.parameter_overrides.max_tokens
        );
        assert_eq!(
            forked_settings.context_message_count,
            source_settings.context_message_count
        );
        assert_eq!(
            forked_settings.selected_preset_id,
            source_settings.selected_preset_id
        );
        assert_eq!(
            forked_settings.system_prompt_mode,
            source_settings.system_prompt_mode
        );
        assert_eq!(
            forked_settings.selected_system_prompt_id,
            source_settings.selected_system_prompt_id
        );
        assert_eq!(
            forked_settings.custom_system_prompt,
            source_settings.custom_system_prompt
        );
        assert_eq!(
            forked_settings.user_prompt_mode,
            source_settings.user_prompt_mode
        );
        assert_eq!(
            forked_settings.selected_user_prompt_id,
            source_settings.selected_user_prompt_id
        );
        assert_eq!(
            forked_settings.custom_user_prompt,
            source_settings.custom_user_prompt
        );
        assert_eq!(
            forked_settings.enabled_mcp_server_ids,
            source_settings.enabled_mcp_server_ids
        );
        assert_eq!(
            forked_settings.enabled_skill_ids,
            source_settings.enabled_skill_ids
        );
        assert_eq!(
            forked_settings.working_directory,
            source_settings.working_directory
        );
        assert_eq!(source_settings.permission_mode, PermissionMode::Ask);
        assert_eq!(forked_settings.permission_mode, PermissionMode::Ask);
    }

    #[tokio::test]
    async fn fork_conversation_relinks_file_attachments() {
        let (db, _dir) = test_db().await;
        let conv = new_conversation(&db, "with files").await;
        let msg = add_message(&db, &conv.id, "see attachment").await;

        let file = db
            .create_file_attachment(CreateFileAttachmentRequest {
                file_name: "notes.txt".to_string(),
                file_size: 12,
                mime_type: "text/plain".to_string(),
                storage_path: "files/hash-notes.txt".to_string(),
                content_hash: "hash-notes".to_string(),
            })
            .await
            .unwrap();
        db.link_message_attachment(&msg.id, &file.id, Some(0))
            .await
            .unwrap();

        let forked = db.fork_conversation(&conv.id, &msg.id).await.unwrap();

        let copied = db
            .list_messages_by_conversation(&forked.id, None, None)
            .await
            .unwrap();
        assert_eq!(copied.len(), 1);
        assert_ne!(copied[0].id, msg.id);

        // The junction row is duplicated; the underlying file row is reused.
        let attachments = db.get_message_attachments(&copied[0].id).await.unwrap();
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].id(), file.id);
    }
}
