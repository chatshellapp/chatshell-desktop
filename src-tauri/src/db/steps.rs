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
            "SELECT id, message_id, content, source, display_order, created_at FROM thinking_steps WHERE id = ?"
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
             FROM thinking_steps WHERE message_id = ? ORDER BY display_order, created_at",
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
        sqlx::query("DELETE FROM thinking_steps WHERE id = ?")
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
             FROM search_decisions WHERE id = ?"
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
             FROM search_decisions WHERE message_id = ? ORDER BY display_order, created_at"
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
        sqlx::query("DELETE FROM search_decisions WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // Tool Call operations
    pub async fn create_tool_call(&self, req: CreateToolCallRequest) -> Result<ToolCall> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let status = req.status.unwrap_or_else(|| "pending".to_string());
        let display_order = req.display_order.unwrap_or(0);

        sqlx::query(
            "INSERT INTO tool_calls (id, message_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, created_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
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
        .execute(self.pool.as_ref())
        .await?;

        self.get_tool_call(&id).await
    }

    pub async fn get_tool_call(&self, id: &str) -> Result<ToolCall> {
        let row = sqlx::query(
            "SELECT id, message_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, created_at, completed_at
             FROM tool_calls WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Tool call not found: {}", id))?;

        Ok(ToolCall {
            id: row.get("id"),
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
            "SELECT id, message_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, created_at, completed_at
             FROM tool_calls WHERE message_id = ? ORDER BY display_order, created_at"
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows
            .iter()
            .map(|row| ToolCall {
                id: row.get("id"),
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
            "UPDATE tool_calls SET status = ?, tool_output = ?, error = ?, duration_ms = ?, completed_at = ? WHERE id = ?"
        )
        .bind(status)
        .bind(output)
        .bind(error)
        .bind(duration_ms)
        .bind(&now)
        .bind(id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    pub async fn delete_tool_call(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM tool_calls WHERE id = ?")
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
            "INSERT INTO code_executions (id, message_id, language, code, output, exit_code, status, error, duration_ms, display_order, created_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        .execute(self.pool.as_ref())
        .await?;

        self.get_code_execution(&id).await
    }

    pub async fn get_code_execution(&self, id: &str) -> Result<CodeExecution> {
        let row = sqlx::query(
            "SELECT id, message_id, language, code, output, exit_code, status, error, duration_ms, display_order, created_at, completed_at
             FROM code_executions WHERE id = ?"
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
             FROM code_executions WHERE message_id = ? ORDER BY display_order, created_at"
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
        sqlx::query("DELETE FROM code_executions WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // Content Block operations
    pub async fn create_content_block(&self, req: CreateContentBlockRequest) -> Result<ContentBlock> {
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
            "SELECT id, message_id, content, display_order, created_at FROM content_blocks WHERE id = ?",
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
             FROM content_blocks WHERE message_id = ? ORDER BY display_order, created_at",
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
        sqlx::query("DELETE FROM content_blocks WHERE id = ?")
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
}
