use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{
    CodeExecution, CreateCodeExecutionRequest, CreateSearchDecisionRequest,
    CreateThinkingStepRequest, CreateToolCallRequest, ProcessStep, SearchDecision, StepType,
    ThinkingStep, ToolCall,
};

impl Database {
    // Thinking Step operations
    pub async fn create_thinking_step(&self, req: CreateThinkingStepRequest) -> Result<ThinkingStep> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let source = req.source.unwrap_or_else(|| "llm".to_string());

        sqlx::query(
            "INSERT INTO thinking_steps (id, content, source, created_at)
             VALUES (?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.content)
        .bind(&source)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_thinking_step(&id).await
    }

    pub async fn get_thinking_step(&self, id: &str) -> Result<ThinkingStep> {
        let row = sqlx::query(
            "SELECT id, content, source, created_at FROM thinking_steps WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Thinking step not found: {}", id))?;

        Ok(ThinkingStep {
            id: row.get("id"),
            content: row.get("content"),
            source: row.get("source"),
            created_at: row.get("created_at"),
        })
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

        sqlx::query(
            "INSERT INTO search_decisions (id, reasoning, search_needed, search_query, search_result_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.reasoning)
        .bind(req.search_needed as i32)
        .bind(&req.search_query)
        .bind(&req.search_result_id)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_search_decision(&id).await
    }

    pub async fn get_search_decision(&self, id: &str) -> Result<SearchDecision> {
        let row = sqlx::query(
            "SELECT id, reasoning, search_needed, search_query, search_result_id, created_at
             FROM search_decisions WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Search decision not found: {}", id))?;

        let search_needed: i32 = row.get("search_needed");

        Ok(SearchDecision {
            id: row.get("id"),
            reasoning: row.get("reasoning"),
            search_needed: search_needed != 0,
            search_query: row.get("search_query"),
            search_result_id: row.get("search_result_id"),
            created_at: row.get("created_at"),
        })
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

        sqlx::query(
            "INSERT INTO tool_calls (id, tool_name, tool_input, tool_output, status, error, duration_ms, created_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.tool_name)
        .bind(&req.tool_input)
        .bind(&req.tool_output)
        .bind(&status)
        .bind(&req.error)
        .bind(req.duration_ms)
        .bind(&now)
        .bind(&req.completed_at)
        .execute(self.pool.as_ref())
        .await?;

        self.get_tool_call(&id).await
    }

    pub async fn get_tool_call(&self, id: &str) -> Result<ToolCall> {
        let row = sqlx::query(
            "SELECT id, tool_name, tool_input, tool_output, status, error, duration_ms, created_at, completed_at
             FROM tool_calls WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Tool call not found: {}", id))?;

        Ok(ToolCall {
            id: row.get("id"),
            tool_name: row.get("tool_name"),
            tool_input: row.get("tool_input"),
            tool_output: row.get("tool_output"),
            status: row.get("status"),
            error: row.get("error"),
            duration_ms: row.get("duration_ms"),
            created_at: row.get("created_at"),
            completed_at: row.get("completed_at"),
        })
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
    pub async fn create_code_execution(&self, req: CreateCodeExecutionRequest) -> Result<CodeExecution> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let status = req.status.unwrap_or_else(|| "pending".to_string());

        sqlx::query(
            "INSERT INTO code_executions (id, language, code, output, exit_code, status, error, duration_ms, created_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&req.language)
        .bind(&req.code)
        .bind(&req.output)
        .bind(req.exit_code)
        .bind(&status)
        .bind(&req.error)
        .bind(req.duration_ms)
        .bind(&now)
        .bind(&req.completed_at)
        .execute(self.pool.as_ref())
        .await?;

        self.get_code_execution(&id).await
    }

    pub async fn get_code_execution(&self, id: &str) -> Result<CodeExecution> {
        let row = sqlx::query(
            "SELECT id, language, code, output, exit_code, status, error, duration_ms, created_at, completed_at
             FROM code_executions WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Code execution not found: {}", id))?;

        Ok(CodeExecution {
            id: row.get("id"),
            language: row.get("language"),
            code: row.get("code"),
            output: row.get("output"),
            exit_code: row.get("exit_code"),
            status: row.get("status"),
            error: row.get("error"),
            duration_ms: row.get("duration_ms"),
            created_at: row.get("created_at"),
            completed_at: row.get("completed_at"),
        })
    }

    pub async fn delete_code_execution(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM code_executions WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    // Message Step Link operations
    pub async fn link_message_step(
        &self,
        message_id: &str,
        step_type: StepType,
        step_id: &str,
        display_order: Option<i32>,
    ) -> Result<()> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let order = display_order.unwrap_or(0);

        sqlx::query(
            "INSERT OR IGNORE INTO message_steps
             (id, message_id, step_type, step_id, display_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(message_id)
        .bind(step_type.to_string())
        .bind(step_id)
        .bind(order)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }

    pub async fn get_message_steps(&self, message_id: &str) -> Result<Vec<ProcessStep>> {
        let rows = sqlx::query(
            "SELECT step_type, step_id, display_order
             FROM message_steps
             WHERE message_id = ?
             ORDER BY display_order, created_at"
        )
        .bind(message_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut steps = Vec::new();
        for row in rows {
            let step_type: String = row.get("step_type");
            let step_id: String = row.get("step_id");

            let step = match step_type.as_str() {
                "thinking" => self
                    .get_thinking_step(&step_id)
                    .await
                    .map(ProcessStep::Thinking)
                    .ok(),
                "search_decision" => self
                    .get_search_decision(&step_id)
                    .await
                    .map(ProcessStep::SearchDecision)
                    .ok(),
                "tool_call" => self
                    .get_tool_call(&step_id)
                    .await
                    .map(ProcessStep::ToolCall)
                    .ok(),
                "code_execution" => self
                    .get_code_execution(&step_id)
                    .await
                    .map(ProcessStep::CodeExecution)
                    .ok(),
                _ => None,
            };
            if let Some(s) = step {
                steps.push(s);
            }
        }

        Ok(steps)
    }

    pub async fn unlink_message_step(
        &self,
        message_id: &str,
        step_type: StepType,
        step_id: &str,
    ) -> Result<()> {
        sqlx::query(
            "DELETE FROM message_steps WHERE message_id = ? AND step_type = ? AND step_id = ?"
        )
        .bind(message_id)
        .bind(step_type.to_string())
        .bind(step_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    // Get All Message Resources (combined)
    pub async fn get_message_resources(&self, message_id: &str) -> Result<crate::models::MessageResources> {
        Ok(crate::models::MessageResources {
            attachments: self.get_message_attachments(message_id).await?,
            contexts: self.get_message_contexts(message_id).await?,
            steps: self.get_message_steps(message_id).await?,
        })
    }
}

