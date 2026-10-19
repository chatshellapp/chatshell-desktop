use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{
    CodeExecution, ContentBlock, CreateCodeExecutionRequest, CreateContentBlockRequest,
    CreateSearchDecisionRequest, CreateThinkingStepRequest, CreateToolCallRequest, ProcessStep,
    SearchDecision, ThinkingStep, ToolCall,
};

impl Database {
    // Thinking Step operations
    pub async fn create_thinking_step(
        &self,
        req: CreateThinkingStepRequest,
    ) -> Result<ThinkingStep> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let source = req.source.unwrap_or_else(|| "llm".to_string());
        let display_order = req.display_order.unwrap_or(0);

        sqlx::query(
            "INSERT INTO thinking_steps (id, message_id, content, source, display_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.message_id)
        .bind(&req.content)
        .bind(&source)
        .bind(display_order)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_thinking_step(&id).await
    }

    pub async fn get_thinking_step(&self, id: &str) -> Result<ThinkingStep> {
        let row = sqlx::query(
            "SELECT id, message_id, content, source, display_order, created_at FROM thinking_steps WHERE thinking_steps.deleted_at IS NULL AND id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Thinking step not found: {}", id))?;

        Ok(ThinkingStep {
            id: row.get("id"),
            message_id: row.get("message_id"),
            content: row.get("content"),
            source: row.get("source"),
            display_order: row.get("display_order"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn get_thinking_steps_by_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<ThinkingStep>> {
        let rows = sqlx::query(
            "SELECT id, message_id, content, source, display_order, created_at 
             FROM thinking_steps WHERE thinking_steps.deleted_at IS NULL AND message_id = ? ORDER BY display_order, created_at",
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows
            .iter()
            .map(|row| ThinkingStep {
                id: row.get("id"),
                message_id: row.get("message_id"),
                content: row.get("content"),
                source: row.get("source"),
                display_order: row.get("display_order"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    pub async fn delete_thinking_step(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "thinking_steps",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    // Search Decision operations
    pub async fn create_search_decision(
        &self,
        req: CreateSearchDecisionRequest,
    ) -> Result<SearchDecision> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let display_order = req.display_order.unwrap_or(0);

        sqlx::query(
            "INSERT INTO search_decisions (id, message_id, reasoning, search_needed, search_query, search_result_id, display_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.message_id)
        .bind(&req.reasoning)
        .bind(req.search_needed as i32)
        .bind(&req.search_query)
        .bind(&req.search_result_id)
        .bind(display_order)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_search_decision(&id).await
    }

    pub async fn get_search_decision(&self, id: &str) -> Result<SearchDecision> {
        let row = sqlx::query(
            "SELECT id, message_id, reasoning, search_needed, search_query, search_result_id, display_order, created_at
             FROM search_decisions WHERE search_decisions.deleted_at IS NULL AND id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Search decision not found: {}", id))?;

        let search_needed: i32 = row.get("search_needed");

        Ok(SearchDecision {
            id: row.get("id"),
            message_id: row.get("message_id"),
            reasoning: row.get("reasoning"),
            search_needed: search_needed != 0,
            search_query: row.get("search_query"),
            search_result_id: row.get("search_result_id"),
            display_order: row.get("display_order"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn get_search_decisions_by_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<SearchDecision>> {
        let rows = sqlx::query(
            "SELECT id, message_id, reasoning, search_needed, search_query, search_result_id, display_order, created_at
             FROM search_decisions WHERE search_decisions.deleted_at IS NULL AND message_id = ? ORDER BY display_order, created_at"
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let search_needed: i32 = row.get("search_needed");
                SearchDecision {
                    id: row.get("id"),
                    message_id: row.get("message_id"),
                    reasoning: row.get("reasoning"),
                    search_needed: search_needed != 0,
                    search_query: row.get("search_query"),
                    search_result_id: row.get("search_result_id"),
                    display_order: row.get("display_order"),
                    created_at: row.get("created_at"),
                }
            })
            .collect())
    }

    pub async fn delete_search_decision(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "search_decisions",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    // Tool Call operations
    pub async fn create_tool_call(&self, req: CreateToolCallRequest) -> Result<ToolCall> {
        let id = req.id.unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        let status = req.status.unwrap_or_else(|| "pending".to_string());
        let display_order = req.display_order.unwrap_or(0);

        sqlx::query(
            "INSERT INTO tool_calls (id, call_id, message_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, created_at, completed_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.call_id)
        .bind(&req.message_id)
        .bind(&req.tool_name)
        .bind(&req.tool_input)
        .bind(&req.tool_output)
        .bind(&status)
        .bind(&req.error)
        .bind(req.duration_ms)
        .bind(display_order)
        .bind(&now)
        .bind(&req.completed_at)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_tool_call(&id).await
    }

    pub async fn get_tool_call(&self, id: &str) -> Result<ToolCall> {
        let row = sqlx::query(
            "SELECT id, call_id, message_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, created_at, completed_at
             FROM tool_calls WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Tool call not found: {}", id))?;

        Ok(ToolCall {
            id: row.get("id"),
            call_id: row.get("call_id"),
            message_id: row.get("message_id"),
            tool_name: row.get("tool_name"),
            tool_input: row.get("tool_input"),
            tool_output: row.get("tool_output"),
            status: row.get("status"),
            error: row.get("error"),
            duration_ms: row.get("duration_ms"),
            display_order: row.get("display_order"),
            created_at: row.get("created_at"),
            completed_at: row.get("completed_at"),
        })
    }

    pub async fn get_tool_calls_by_message(&self, message_id: &str) -> Result<Vec<ToolCall>> {
        let rows = sqlx::query(
            "SELECT id, call_id, message_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, created_at, completed_at
             FROM tool_calls WHERE message_id = ? ORDER BY display_order, created_at"
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows
            .iter()
            .map(|row| ToolCall {
                id: row.get("id"),
                call_id: row.get("call_id"),
                message_id: row.get("message_id"),
                tool_name: row.get("tool_name"),
                tool_input: row.get("tool_input"),
                tool_output: row.get("tool_output"),
                status: row.get("status"),
                error: row.get("error"),
                duration_ms: row.get("duration_ms"),
                display_order: row.get("display_order"),
                created_at: row.get("created_at"),
                completed_at: row.get("completed_at"),
            })
            .collect())
    }

    pub async fn update_tool_call_status(
        &self,
        id: &str,
        status: &str,
        output: Option<&str>,
        error: Option<&str>,
        duration_ms: Option<i64>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE tool_calls SET status = ?, tool_output = ?, error = ?, duration_ms = ?, completed_at = ?, updated_at = ? WHERE id = ?"
        )
        .bind(status)
        .bind(output)
        .bind(error)
        .bind(duration_ms)
        .bind(&now)
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    pub async fn delete_tool_call(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "tool_calls",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    // Code Execution operations
    pub async fn create_code_execution(
        &self,
        req: CreateCodeExecutionRequest,
    ) -> Result<CodeExecution> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let status = req.status.unwrap_or_else(|| "pending".to_string());
        let display_order = req.display_order.unwrap_or(0);

        sqlx::query(
            "INSERT INTO code_executions (id, message_id, language, code, output, exit_code, status, error, duration_ms, display_order, created_at, completed_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.message_id)
        .bind(&req.language)
        .bind(&req.code)
        .bind(&req.output)
        .bind(req.exit_code)
        .bind(&status)
        .bind(&req.error)
        .bind(req.duration_ms)
        .bind(display_order)
        .bind(&now)
        .bind(&req.completed_at)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_code_execution(&id).await
    }

    pub async fn get_code_execution(&self, id: &str) -> Result<CodeExecution> {
        let row = sqlx::query(
            "SELECT id, message_id, language, code, output, exit_code, status, error, duration_ms, display_order, created_at, completed_at
             FROM code_executions WHERE code_executions.deleted_at IS NULL AND id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Code execution not found: {}", id))?;

        Ok(CodeExecution {
            id: row.get("id"),
            message_id: row.get("message_id"),
            language: row.get("language"),
            code: row.get("code"),
            output: row.get("output"),
            exit_code: row.get("exit_code"),
            status: row.get("status"),
            error: row.get("error"),
            duration_ms: row.get("duration_ms"),
            display_order: row.get("display_order"),
            created_at: row.get("created_at"),
            completed_at: row.get("completed_at"),
        })
    }

    pub async fn get_code_executions_by_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<CodeExecution>> {
        let rows = sqlx::query(
            "SELECT id, message_id, language, code, output, exit_code, status, error, duration_ms, display_order, created_at, completed_at
             FROM code_executions WHERE code_executions.deleted_at IS NULL AND message_id = ? ORDER BY display_order, created_at"
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows
            .iter()
            .map(|row| CodeExecution {
                id: row.get("id"),
                message_id: row.get("message_id"),
                language: row.get("language"),
                code: row.get("code"),
                output: row.get("output"),
                exit_code: row.get("exit_code"),
                status: row.get("status"),
                error: row.get("error"),
                duration_ms: row.get("duration_ms"),
                display_order: row.get("display_order"),
                created_at: row.get("created_at"),
                completed_at: row.get("completed_at"),
            })
            .collect())
    }

    pub async fn delete_code_execution(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "code_executions",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    // Content Block operations
    pub async fn create_content_block(
        &self,
        req: CreateContentBlockRequest,
    ) -> Result<ContentBlock> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO content_blocks (id, message_id, content, display_order, created_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.message_id)
        .bind(&req.content)
        .bind(req.display_order)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_content_block(&id).await
    }

    pub async fn get_content_block(&self, id: &str) -> Result<ContentBlock> {
        let row = sqlx::query(
            "SELECT id, message_id, content, display_order, created_at FROM content_blocks WHERE content_blocks.deleted_at IS NULL AND id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Content block not found: {}", id))?;

        Ok(ContentBlock {
            id: row.get("id"),
            message_id: row.get("message_id"),
            content: row.get("content"),
            display_order: row.get("display_order"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn get_content_blocks_by_message(
        &self,
        message_id: &str,
    ) -> Result<Vec<ContentBlock>> {
        let rows = sqlx::query(
            "SELECT id, message_id, content, display_order, created_at
             FROM content_blocks WHERE content_blocks.deleted_at IS NULL AND message_id = ? ORDER BY display_order, created_at",
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows
            .iter()
            .map(|row| ContentBlock {
                id: row.get("id"),
                message_id: row.get("message_id"),
                content: row.get("content"),
                display_order: row.get("display_order"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    pub async fn delete_content_block(&self, id: &str) -> Result<()> {
        sqlx::query(&crate::db::soft_delete::tombstone_update(
            "content_blocks",
            "id = ?2 AND deleted_at IS NULL",
        ))
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    // Get all process steps for a message (combined from all step tables)
    pub async fn get_message_steps(&self, message_id: &str) -> Result<Vec<ProcessStep>> {
        let mut steps: Vec<(i32, String, ProcessStep)> = Vec::new();

        // Fetch thinking steps
        for step in self.get_thinking_steps_by_message(message_id).await? {
            steps.push((
                step.display_order,
                step.created_at.clone(),
                ProcessStep::Thinking(step),
            ));
        }

        // Fetch search decisions
        for step in self.get_search_decisions_by_message(message_id).await? {
            steps.push((
                step.display_order,
                step.created_at.clone(),
                ProcessStep::SearchDecision(step),
            ));
        }

        // Fetch tool calls
        for step in self.get_tool_calls_by_message(message_id).await? {
            steps.push((
                step.display_order,
                step.created_at.clone(),
                ProcessStep::ToolCall(step),
            ));
        }

        // Fetch code executions
        for step in self.get_code_executions_by_message(message_id).await? {
            steps.push((
                step.display_order,
                step.created_at.clone(),
                ProcessStep::CodeExecution(step),
            ));
        }

        // Fetch content blocks
        for block in self.get_content_blocks_by_message(message_id).await? {
            steps.push((
                block.display_order,
                block.created_at.clone(),
                ProcessStep::ContentBlock(block),
            ));
        }

        // Sort by display_order, then by created_at
        steps.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        Ok(steps.into_iter().map(|(_, _, step)| step).collect())
    }

    // Get All Message Resources (combined)
    pub async fn get_message_resources(
        &self,
        message_id: &str,
    ) -> Result<crate::models::MessageResources> {
        Ok(crate::models::MessageResources {
            attachments: self.get_message_attachments(message_id).await?,
            contexts: self.get_message_contexts(message_id).await?,
            steps: self.get_message_steps(message_id).await?,
        })
    }

    /// Batch variant of `get_message_resources`: fetches resources for many
    /// messages concurrently over the connection pool and returns only the
    /// messages that have any (attachments, contexts, or steps).
    pub async fn get_message_resources_batch(
        &self,
        message_ids: &[String],
    ) -> Result<std::collections::HashMap<String, crate::models::MessageResources>> {
        let results = futures::future::try_join_all(
            message_ids.iter().map(|id| self.get_message_resources(id)),
        )
        .await?;

        let mut map = std::collections::HashMap::with_capacity(results.len());
        for (id, resources) in message_ids.iter().zip(results) {
            if !resources.attachments.is_empty()
                || !resources.contexts.is_empty()
                || !resources.steps.is_empty()
            {
                map.insert(id.clone(), resources);
            }
        }
        Ok(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        CreateFileAttachmentRequest, CreateMessageRequest, StepType, UserAttachment,
    };

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    /// Every step table has `FOREIGN KEY (message_id) REFERENCES messages(id)`,
    /// so tests must create a parent message first.
    async fn new_message_id(db: &Database) -> String {
        db.create_message(CreateMessageRequest {
            conversation_id: None,
            sender_type: "assistant".to_string(),
            sender_id: None,
            content: "parent message".to_string(),
            tokens: Some(1),
        })
        .await
        .unwrap()
        .id
    }

    async fn row_deleted_at(db: &Database, table: &str, id: &str) -> Option<String> {
        sqlx::query_scalar(&format!("SELECT deleted_at FROM {table} WHERE id = ?"))
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn thinking_step_roundtrip_applies_defaults() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let step = db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: msg.clone(),
                content: "analyzing the request".to_string(),
                source: None,
                display_order: None,
            })
            .await
            .unwrap();

        assert_eq!(step.message_id, msg);
        assert_eq!(step.content, "analyzing the request");
        assert_eq!(step.source, "llm", "source defaults to llm");
        assert_eq!(step.display_order, 0, "display_order defaults to 0");
        assert!(!step.created_at.is_empty());

        let fetched = db.get_thinking_step(&step.id).await.unwrap();
        assert_eq!(fetched.id, step.id);
        assert_eq!(fetched.content, step.content);
        assert_eq!(fetched.source, step.source);
        assert_eq!(fetched.display_order, step.display_order);

        let explicit = db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: msg,
                content: "deep reasoning".to_string(),
                source: Some("extended_thinking".to_string()),
                display_order: Some(7),
            })
            .await
            .unwrap();
        assert_eq!(explicit.source, "extended_thinking");
        assert_eq!(explicit.display_order, 7);
    }

    #[tokio::test]
    async fn thinking_steps_by_message_ordered_and_scoped() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;
        let other = new_message_id(&db).await;

        // Insert out of order to prove sorting is the query's, not ours.
        for order in [2, 0, 1] {
            db.create_thinking_step(CreateThinkingStepRequest {
                message_id: msg.clone(),
                content: format!("step {order}"),
                source: None,
                display_order: Some(order),
            })
            .await
            .unwrap();
        }
        db.create_thinking_step(CreateThinkingStepRequest {
            message_id: other.clone(),
            content: "belongs to another message".to_string(),
            source: None,
            display_order: Some(9),
        })
        .await
        .unwrap();

        let steps = db.get_thinking_steps_by_message(&msg).await.unwrap();
        let orders: Vec<i32> = steps.iter().map(|s| s.display_order).collect();
        assert_eq!(orders, vec![0, 1, 2]);
        assert!(steps.iter().all(|s| s.message_id == msg));

        assert_eq!(
            db.get_thinking_steps_by_message(&other)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(
            db.get_thinking_steps_by_message("no-such-message")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn delete_thinking_step_tombstones_row() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;
        let step = db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: msg.clone(),
                content: "temporary".to_string(),
                source: None,
                display_order: None,
            })
            .await
            .unwrap();

        db.delete_thinking_step(&step.id).await.unwrap();

        assert!(
            db.get_thinking_step(&step.id).await.is_err(),
            "deleted step is no longer readable"
        );
        assert!(
            db.get_thinking_steps_by_message(&msg)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            row_deleted_at(&db, "thinking_steps", &step.id)
                .await
                .is_some(),
            "delete is a tombstone, not a hard DELETE"
        );

        // Deleting an already-deleted row is a no-op that still reports Ok.
        db.delete_thinking_step(&step.id).await.unwrap();
    }

    #[tokio::test]
    async fn search_decision_roundtrip_maps_bool_flag() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let needed = db
            .create_search_decision(CreateSearchDecisionRequest {
                message_id: msg.clone(),
                reasoning: "recent events require a web search".to_string(),
                search_needed: true,
                search_query: Some("rust 1.90 release".to_string()),
                search_result_id: None,
                display_order: Some(3),
            })
            .await
            .unwrap();
        assert!(needed.search_needed);
        assert_eq!(needed.reasoning, "recent events require a web search");
        assert_eq!(needed.search_query.as_deref(), Some("rust 1.90 release"));
        assert_eq!(needed.search_result_id, None);
        assert_eq!(needed.display_order, 3);
        assert_eq!(needed.message_id, msg);
        assert!(!needed.created_at.is_empty());

        // bool is stored as INTEGER; verify the mapping is 1/0, not text.
        let stored: i32 =
            sqlx::query_scalar("SELECT search_needed FROM search_decisions WHERE id = ?")
                .bind(&needed.id)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(stored, 1);

        let not_needed = db
            .create_search_decision(CreateSearchDecisionRequest {
                message_id: msg,
                reasoning: "answer already in context".to_string(),
                search_needed: false,
                search_query: None,
                search_result_id: None,
                display_order: None,
            })
            .await
            .unwrap();
        assert!(!not_needed.search_needed);
        assert_eq!(not_needed.search_query, None);
        assert_eq!(not_needed.display_order, 0, "display_order defaults to 0");
    }

    #[tokio::test]
    async fn search_decisions_by_message_ordered_and_scoped() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;
        let other = new_message_id(&db).await;

        for order in [1, 0] {
            db.create_search_decision(CreateSearchDecisionRequest {
                message_id: msg.clone(),
                reasoning: format!("reason {order}"),
                search_needed: order == 0,
                search_query: None,
                search_result_id: None,
                display_order: Some(order),
            })
            .await
            .unwrap();
        }
        db.create_search_decision(CreateSearchDecisionRequest {
            message_id: other,
            reasoning: "other message".to_string(),
            search_needed: true,
            search_query: None,
            search_result_id: None,
            display_order: None,
        })
        .await
        .unwrap();

        let decisions = db.get_search_decisions_by_message(&msg).await.unwrap();
        let orders: Vec<i32> = decisions.iter().map(|d| d.display_order).collect();
        assert_eq!(orders, vec![0, 1]);
        assert!(
            decisions[0].search_needed,
            "order-0 row maps search_needed=true"
        );
        assert!(
            !decisions[1].search_needed,
            "order-1 row maps search_needed=false"
        );
        assert!(decisions.iter().all(|d| d.message_id == msg));
    }

    #[tokio::test]
    async fn delete_search_decision_tombstones_row() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;
        let decision = db
            .create_search_decision(CreateSearchDecisionRequest {
                message_id: msg.clone(),
                reasoning: "short-lived".to_string(),
                search_needed: true,
                search_query: Some("q".to_string()),
                search_result_id: None,
                display_order: None,
            })
            .await
            .unwrap();

        db.delete_search_decision(&decision.id).await.unwrap();

        assert!(db.get_search_decision(&decision.id).await.is_err());
        assert!(
            db.get_search_decisions_by_message(&msg)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            row_deleted_at(&db, "search_decisions", &decision.id)
                .await
                .is_some()
        );
    }

    #[tokio::test]
    async fn tool_call_roundtrip_defaults_and_generated_id() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let call = db
            .create_tool_call(CreateToolCallRequest {
                id: None,
                call_id: Some("call_abc".to_string()),
                message_id: msg.clone(),
                tool_name: "web_search".to_string(),
                tool_input: Some(r#"{"query":"rust sqlite"}"#.to_string()),
                tool_output: Some(r#"{"results":[]}"#.to_string()),
                status: None,
                error: None,
                duration_ms: Some(42),
                display_order: None,
                completed_at: Some("2026-01-01T00:00:00Z".to_string()),
            })
            .await
            .unwrap();

        assert!(!call.id.is_empty(), "id is generated when not supplied");
        assert_eq!(call.call_id.as_deref(), Some("call_abc"));
        assert_eq!(call.message_id, msg);
        assert_eq!(call.tool_name, "web_search");
        assert_eq!(
            call.tool_input.as_deref(),
            Some(r#"{"query":"rust sqlite"}"#)
        );
        assert_eq!(call.tool_output.as_deref(), Some(r#"{"results":[]}"#));
        assert_eq!(call.status, "pending", "status defaults to pending");
        assert_eq!(call.error, None);
        assert_eq!(call.duration_ms, Some(42));
        assert_eq!(call.display_order, 0, "display_order defaults to 0");
        assert_eq!(call.completed_at.as_deref(), Some("2026-01-01T00:00:00Z"));
        assert!(!call.created_at.is_empty());

        let fetched = db.get_tool_call(&call.id).await.unwrap();
        assert_eq!(fetched.id, call.id);
        assert_eq!(fetched.call_id, call.call_id);
        assert_eq!(fetched.tool_name, call.tool_name);
        assert_eq!(fetched.duration_ms, call.duration_ms);
    }

    #[tokio::test]
    async fn tool_call_keeps_caller_supplied_id() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let call = db
            .create_tool_call(CreateToolCallRequest {
                id: Some("fc_01".to_string()),
                call_id: None,
                message_id: msg,
                tool_name: "shell".to_string(),
                tool_input: None,
                tool_output: None,
                status: Some("running".to_string()),
                error: None,
                duration_ms: None,
                display_order: Some(5),
                completed_at: None,
            })
            .await
            .unwrap();

        assert_eq!(call.id, "fc_01");
        assert_eq!(call.call_id, None);
        assert_eq!(call.status, "running");
        assert_eq!(call.display_order, 5);
        assert_eq!(call.tool_input, None);
        assert_eq!(call.completed_at, None);
    }

    #[tokio::test]
    async fn tool_calls_by_message_ordered_and_scoped() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;
        let other = new_message_id(&db).await;

        for order in [3, 1] {
            db.create_tool_call(CreateToolCallRequest {
                id: None,
                call_id: None,
                message_id: msg.clone(),
                tool_name: format!("tool_{order}"),
                tool_input: None,
                tool_output: None,
                status: None,
                error: None,
                duration_ms: None,
                display_order: Some(order),
                completed_at: None,
            })
            .await
            .unwrap();
        }
        db.create_tool_call(CreateToolCallRequest {
            id: None,
            call_id: None,
            message_id: other,
            tool_name: "other_tool".to_string(),
            tool_input: None,
            tool_output: None,
            status: None,
            error: None,
            duration_ms: None,
            display_order: None,
            completed_at: None,
        })
        .await
        .unwrap();

        let calls = db.get_tool_calls_by_message(&msg).await.unwrap();
        let names: Vec<&str> = calls.iter().map(|c| c.tool_name.as_str()).collect();
        assert_eq!(names, vec!["tool_1", "tool_3"]);
    }

    #[tokio::test]
    async fn update_tool_call_status_walks_pending_running_success_error() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let call = db
            .create_tool_call(CreateToolCallRequest {
                id: None,
                call_id: None,
                message_id: msg,
                tool_name: "web_search".to_string(),
                tool_input: None,
                tool_output: Some("partial stream".to_string()),
                status: None,
                error: None,
                duration_ms: None,
                display_order: None,
                completed_at: None,
            })
            .await
            .unwrap();
        assert_eq!(call.status, "pending");

        // pending -> running: omitted fields are overwritten, not preserved.
        db.update_tool_call_status(&call.id, "running", None, None, None)
            .await
            .unwrap();
        let running = db.get_tool_call(&call.id).await.unwrap();
        assert_eq!(running.status, "running");
        assert_eq!(
            running.tool_output, None,
            "passing None overwrites the previous output"
        );
        assert_eq!(running.error, None);
        // The UPDATE always binds completed_at = now, regardless of status.
        assert!(running.completed_at.is_some());

        // running -> success stamps output, duration and completed_at.
        db.update_tool_call_status(
            &call.id,
            "success",
            Some(r#"{"ok":true}"#),
            None,
            Some(1200),
        )
        .await
        .unwrap();
        let done = db.get_tool_call(&call.id).await.unwrap();
        assert_eq!(done.status, "success");
        assert_eq!(done.tool_output.as_deref(), Some(r#"{"ok":true}"#));
        assert_eq!(done.error, None);
        assert_eq!(done.duration_ms, Some(1200));
        assert!(done.completed_at.is_some(), "success stamps completed_at");

        // success -> error replaces output with the error message.
        db.update_tool_call_status(&call.id, "error", None, Some("boom"), Some(50))
            .await
            .unwrap();
        let failed = db.get_tool_call(&call.id).await.unwrap();
        assert_eq!(failed.status, "error");
        assert_eq!(failed.tool_output, None);
        assert_eq!(failed.error.as_deref(), Some("boom"));
        assert_eq!(failed.duration_ms, Some(50));

        // Updating a nonexistent id is a no-op that still reports Ok.
        db.update_tool_call_status("no-such-id", "success", None, None, None)
            .await
            .unwrap();
        assert!(db.get_tool_call("no-such-id").await.is_err());
    }

    #[tokio::test]
    async fn delete_tool_call_tombstones_row() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let call = db
            .create_tool_call(CreateToolCallRequest {
                id: None,
                call_id: None,
                message_id: msg,
                tool_name: "web_search".to_string(),
                tool_input: None,
                tool_output: None,
                status: None,
                error: None,
                duration_ms: None,
                display_order: None,
                completed_at: None,
            })
            .await
            .unwrap();

        db.delete_tool_call(&call.id).await.unwrap();

        // tool_calls reads do not filter on deleted_at, so assert the
        // tombstone directly against the row.
        assert!(
            row_deleted_at(&db, "tool_calls", &call.id).await.is_some(),
            "delete_tool_call sets deleted_at"
        );
    }

    #[tokio::test]
    async fn code_execution_roundtrip_and_defaults() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let minimal = db
            .create_code_execution(CreateCodeExecutionRequest {
                message_id: msg.clone(),
                language: "python".to_string(),
                code: "print(1)".to_string(),
                output: None,
                exit_code: None,
                status: None,
                error: None,
                duration_ms: None,
                display_order: None,
                completed_at: None,
            })
            .await
            .unwrap();
        assert_eq!(minimal.message_id, msg);
        assert_eq!(minimal.language, "python");
        assert_eq!(minimal.code, "print(1)");
        assert_eq!(minimal.output, None);
        assert_eq!(minimal.exit_code, None);
        assert_eq!(minimal.status, "pending", "status defaults to pending");
        assert_eq!(minimal.error, None);
        assert_eq!(minimal.duration_ms, None);
        assert_eq!(minimal.display_order, 0, "display_order defaults to 0");
        assert_eq!(minimal.completed_at, None);
        assert!(!minimal.created_at.is_empty());

        let full = db
            .create_code_execution(CreateCodeExecutionRequest {
                message_id: msg,
                language: "bash".to_string(),
                code: "exit 3".to_string(),
                output: Some("stderr noise".to_string()),
                exit_code: Some(3),
                status: Some("error".to_string()),
                error: Some("nonzero exit".to_string()),
                duration_ms: Some(99),
                display_order: Some(2),
                completed_at: Some("2026-02-02T00:00:00Z".to_string()),
            })
            .await
            .unwrap();
        assert_eq!(full.output.as_deref(), Some("stderr noise"));
        assert_eq!(full.exit_code, Some(3));
        assert_eq!(full.status, "error");
        assert_eq!(full.error.as_deref(), Some("nonzero exit"));
        assert_eq!(full.duration_ms, Some(99));
        assert_eq!(full.display_order, 2);
        assert_eq!(full.completed_at.as_deref(), Some("2026-02-02T00:00:00Z"));

        let fetched = db.get_code_execution(&minimal.id).await.unwrap();
        assert_eq!(fetched.id, minimal.id);
        assert_eq!(fetched.language, minimal.language);
    }

    #[tokio::test]
    async fn code_executions_by_message_ordered_and_scoped() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;
        let other = new_message_id(&db).await;

        for order in [2, 0] {
            db.create_code_execution(CreateCodeExecutionRequest {
                message_id: msg.clone(),
                language: "python".to_string(),
                code: format!("print({order})"),
                output: None,
                exit_code: None,
                status: None,
                error: None,
                duration_ms: None,
                display_order: Some(order),
                completed_at: None,
            })
            .await
            .unwrap();
        }
        db.create_code_execution(CreateCodeExecutionRequest {
            message_id: other,
            language: "python".to_string(),
            code: "print('other')".to_string(),
            output: None,
            exit_code: None,
            status: None,
            error: None,
            duration_ms: None,
            display_order: None,
            completed_at: None,
        })
        .await
        .unwrap();

        let executions = db.get_code_executions_by_message(&msg).await.unwrap();
        let codes: Vec<&str> = executions.iter().map(|e| e.code.as_str()).collect();
        assert_eq!(codes, vec!["print(0)", "print(2)"]);
        assert!(executions.iter().all(|e| e.message_id == msg));
        assert!(
            db.get_code_executions_by_message("no-such-message")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn delete_code_execution_tombstones_row() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let execution = db
            .create_code_execution(CreateCodeExecutionRequest {
                message_id: msg.clone(),
                language: "python".to_string(),
                code: "print(1)".to_string(),
                output: None,
                exit_code: None,
                status: None,
                error: None,
                duration_ms: None,
                display_order: None,
                completed_at: None,
            })
            .await
            .unwrap();

        db.delete_code_execution(&execution.id).await.unwrap();

        assert!(db.get_code_execution(&execution.id).await.is_err());
        assert!(
            db.get_code_executions_by_message(&msg)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            row_deleted_at(&db, "code_executions", &execution.id)
                .await
                .is_some()
        );
    }

    #[tokio::test]
    async fn content_block_roundtrip_and_ordering() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let second = db
            .create_content_block(CreateContentBlockRequest {
                message_id: msg.clone(),
                content: "after the tool call".to_string(),
                display_order: 1,
            })
            .await
            .unwrap();
        let first = db
            .create_content_block(CreateContentBlockRequest {
                message_id: msg.clone(),
                content: "before the tool call".to_string(),
                display_order: 0,
            })
            .await
            .unwrap();

        assert_eq!(first.content, "before the tool call");
        assert_eq!(first.display_order, 0);
        assert_eq!(first.message_id, msg);
        assert!(!first.created_at.is_empty());

        let fetched = db.get_content_block(&second.id).await.unwrap();
        assert_eq!(fetched.id, second.id);
        assert_eq!(fetched.content, second.content);

        // Insertion order (1 then 0) must not survive the read.
        let blocks = db.get_content_blocks_by_message(&msg).await.unwrap();
        let ids: Vec<&str> = blocks.iter().map(|b| b.id.as_str()).collect();
        assert_eq!(ids, vec![first.id.as_str(), second.id.as_str()]);
        assert!(
            db.get_content_blocks_by_message("no-such-message")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn delete_content_block_tombstones_row() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let block = db
            .create_content_block(CreateContentBlockRequest {
                message_id: msg.clone(),
                content: "temporary".to_string(),
                display_order: 0,
            })
            .await
            .unwrap();

        db.delete_content_block(&block.id).await.unwrap();

        assert!(db.get_content_block(&block.id).await.is_err());
        assert!(
            db.get_content_blocks_by_message(&msg)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            row_deleted_at(&db, "content_blocks", &block.id)
                .await
                .is_some()
        );
    }

    #[tokio::test]
    async fn missing_step_lookups_return_err() {
        let (db, _dir) = test_db().await;
        assert!(db.get_thinking_step("missing").await.is_err());
        assert!(db.get_search_decision("missing").await.is_err());
        assert!(db.get_tool_call("missing").await.is_err());
        assert!(db.get_code_execution("missing").await.is_err());
        assert!(db.get_content_block("missing").await.is_err());
    }

    #[tokio::test]
    async fn create_step_requires_existing_parent_message() {
        let (db, _dir) = test_db().await;
        let res = db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: "no-such-message".to_string(),
                content: "orphan".to_string(),
                source: None,
                display_order: None,
            })
            .await;
        assert!(res.is_err(), "message_id FK must be enforced");
    }

    #[tokio::test]
    async fn get_message_steps_merges_all_step_types_in_display_order() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let think = db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: msg.clone(),
                content: "plan the work".to_string(),
                source: None,
                display_order: Some(0),
            })
            .await
            .unwrap();
        let tool = db
            .create_tool_call(CreateToolCallRequest {
                id: None,
                call_id: Some("call_1".to_string()),
                message_id: msg.clone(),
                tool_name: "web_search".to_string(),
                tool_input: None,
                tool_output: None,
                status: Some("success".to_string()),
                error: None,
                duration_ms: Some(10),
                display_order: Some(1),
                completed_at: None,
            })
            .await
            .unwrap();
        let block = db
            .create_content_block(CreateContentBlockRequest {
                message_id: msg.clone(),
                content: "partial answer".to_string(),
                display_order: 2,
            })
            .await
            .unwrap();
        let code = db
            .create_code_execution(CreateCodeExecutionRequest {
                message_id: msg.clone(),
                language: "python".to_string(),
                code: "print(1)".to_string(),
                output: Some("1".to_string()),
                exit_code: Some(0),
                status: Some("success".to_string()),
                error: None,
                duration_ms: None,
                display_order: Some(3),
                completed_at: None,
            })
            .await
            .unwrap();
        let search = db
            .create_search_decision(CreateSearchDecisionRequest {
                message_id: msg.clone(),
                reasoning: "need fresh data".to_string(),
                search_needed: true,
                search_query: Some("latest news".to_string()),
                search_result_id: None,
                display_order: Some(4),
            })
            .await
            .unwrap();

        let steps = db.get_message_steps(&msg).await.unwrap();
        assert_eq!(
            steps.iter().map(|s| s.step_type()).collect::<Vec<_>>(),
            vec![
                StepType::Thinking,
                StepType::ToolCall,
                StepType::ContentBlock,
                StepType::CodeExecution,
                StepType::SearchDecision,
            ]
        );
        assert_eq!(steps[0].id(), think.id);
        assert_eq!(steps[1].id(), tool.id);
        assert_eq!(steps[2].id(), block.id);
        assert_eq!(steps[3].id(), code.id);
        assert_eq!(steps[4].id(), search.id);

        // Payloads survive the merge into the unified enum.
        assert!(matches!(&steps[0], ProcessStep::Thinking(t) if t.content == "plan the work"));
        assert!(matches!(
            &steps[1],
            ProcessStep::ToolCall(t) if t.tool_name == "web_search" && t.status == "success"
        ));
        assert!(matches!(&steps[2], ProcessStep::ContentBlock(b) if b.content == "partial answer"));
        assert!(matches!(
            &steps[3],
            ProcessStep::CodeExecution(c) if c.language == "python" && c.exit_code == Some(0)
        ));
        assert!(matches!(
            &steps[4],
            ProcessStep::SearchDecision(d) if d.search_needed && d.search_query.as_deref() == Some("latest news")
        ));

        // Steps on other messages are excluded; unknown messages are empty, not an error.
        let other = new_message_id(&db).await;
        db.create_thinking_step(CreateThinkingStepRequest {
            message_id: other,
            content: "elsewhere".to_string(),
            source: None,
            display_order: Some(0),
        })
        .await
        .unwrap();
        assert_eq!(db.get_message_steps(&msg).await.unwrap().len(), 5);
        assert!(
            db.get_message_steps("no-such-message")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn get_message_steps_breaks_display_order_ties_by_created_at() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        // Three different step types sharing display_order 0: created_at
        // (= creation order here) decides, regardless of step type.
        let a = db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: msg.clone(),
                content: "first".to_string(),
                source: None,
                display_order: Some(0),
            })
            .await
            .unwrap();
        let b = db
            .create_search_decision(CreateSearchDecisionRequest {
                message_id: msg.clone(),
                reasoning: "second".to_string(),
                search_needed: false,
                search_query: None,
                search_result_id: None,
                display_order: Some(0),
            })
            .await
            .unwrap();
        let c = db
            .create_tool_call(CreateToolCallRequest {
                id: None,
                call_id: None,
                message_id: msg.clone(),
                tool_name: "third".to_string(),
                tool_input: None,
                tool_output: None,
                status: None,
                error: None,
                duration_ms: None,
                display_order: Some(0),
                completed_at: None,
            })
            .await
            .unwrap();

        let steps = db.get_message_steps(&msg).await.unwrap();
        let ids: Vec<&str> = steps.iter().map(|s| s.id()).collect();
        assert_eq!(ids, vec![a.id.as_str(), b.id.as_str(), c.id.as_str()]);
    }

    #[tokio::test]
    async fn hard_deleting_message_cascades_to_all_step_tables() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        db.create_thinking_step(CreateThinkingStepRequest {
            message_id: msg.clone(),
            content: "x".to_string(),
            source: None,
            display_order: None,
        })
        .await
        .unwrap();
        db.create_search_decision(CreateSearchDecisionRequest {
            message_id: msg.clone(),
            reasoning: "x".to_string(),
            search_needed: true,
            search_query: None,
            search_result_id: None,
            display_order: None,
        })
        .await
        .unwrap();
        db.create_tool_call(CreateToolCallRequest {
            id: None,
            call_id: None,
            message_id: msg.clone(),
            tool_name: "t".to_string(),
            tool_input: None,
            tool_output: None,
            status: None,
            error: None,
            duration_ms: None,
            display_order: None,
            completed_at: None,
        })
        .await
        .unwrap();
        db.create_code_execution(CreateCodeExecutionRequest {
            message_id: msg.clone(),
            language: "python".to_string(),
            code: "pass".to_string(),
            output: None,
            exit_code: None,
            status: None,
            error: None,
            duration_ms: None,
            display_order: None,
            completed_at: None,
        })
        .await
        .unwrap();
        db.create_content_block(CreateContentBlockRequest {
            message_id: msg.clone(),
            content: "x".to_string(),
            display_order: 0,
        })
        .await
        .unwrap();

        sqlx::query("DELETE FROM messages WHERE id = ?")
            .bind(&msg)
            .execute(db.pool())
            .await
            .unwrap();

        assert!(db.get_message_steps(&msg).await.unwrap().is_empty());
        for table in [
            "thinking_steps",
            "search_decisions",
            "tool_calls",
            "code_executions",
            "content_blocks",
        ] {
            let count: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {table} WHERE message_id = ?"
            ))
            .bind(&msg)
            .fetch_one(db.pool())
            .await
            .unwrap();
            assert_eq!(count, 0, "{table} rows must cascade with the message");
        }
    }

    #[tokio::test]
    async fn get_message_resources_combines_attachments_and_steps() {
        let (db, _dir) = test_db().await;
        let msg = new_message_id(&db).await;

        let file = db
            .create_file_attachment(CreateFileAttachmentRequest {
                file_name: "notes.txt".to_string(),
                file_size: 12,
                mime_type: "text/plain".to_string(),
                storage_path: "/tmp/notes.txt".to_string(),
                content_hash: "hash-steps-1".to_string(),
            })
            .await
            .unwrap();
        db.link_message_attachment(&msg, &file.id, Some(0))
            .await
            .unwrap();
        let thinking = db
            .create_thinking_step(CreateThinkingStepRequest {
                message_id: msg.clone(),
                content: "reasoning".to_string(),
                source: None,
                display_order: Some(0),
            })
            .await
            .unwrap();

        let resources = db.get_message_resources(&msg).await.unwrap();
        assert_eq!(resources.attachments.len(), 1);
        assert!(matches!(
            &resources.attachments[0],
            UserAttachment::File(f) if f.id == file.id
        ));
        assert!(resources.contexts.is_empty());
        assert_eq!(resources.steps.len(), 1);
        assert_eq!(resources.steps[0].id(), thinking.id);

        // A message with nothing attached yields empty collections, not an error.
        let bare = new_message_id(&db).await;
        let empty = db.get_message_resources(&bare).await.unwrap();
        assert!(empty.attachments.is_empty());
        assert!(empty.contexts.is_empty());
        assert!(empty.steps.is_empty());
    }

    #[tokio::test]
    async fn get_message_resources_batch_returns_only_messages_with_resources() {
        let (db, _dir) = test_db().await;
        let bare = new_message_id(&db).await;
        let rich = new_message_id(&db).await;

        db.create_tool_call(CreateToolCallRequest {
            id: None,
            call_id: None,
            message_id: rich.clone(),
            tool_name: "web_search".to_string(),
            tool_input: None,
            tool_output: None,
            status: None,
            error: None,
            duration_ms: None,
            display_order: Some(0),
            completed_at: None,
        })
        .await
        .unwrap();
        db.create_content_block(CreateContentBlockRequest {
            message_id: rich.clone(),
            content: "answer".to_string(),
            display_order: 1,
        })
        .await
        .unwrap();

        let map = db
            .get_message_resources_batch(&[
                bare.clone(),
                rich.clone(),
                "no-such-message".to_string(),
            ])
            .await
            .unwrap();

        assert_eq!(map.len(), 1, "only messages with resources are returned");
        let resources = map.get(&rich).unwrap();
        assert_eq!(resources.steps.len(), 2);
        assert_eq!(
            resources
                .steps
                .iter()
                .map(|s| s.step_type())
                .collect::<Vec<_>>(),
            vec![StepType::ToolCall, StepType::ContentBlock]
        );
        assert!(!map.contains_key(&bare));

        // Empty input is fine.
        assert!(
            db.get_message_resources_batch(&[])
                .await
                .unwrap()
                .is_empty()
        );
    }
}
