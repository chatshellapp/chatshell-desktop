use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ==========================================================================
// PROCESS STEPS (AI workflow artifacts)
// ==========================================================================

/// Thinking step - stores AI's reasoning/thinking process
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ThinkingStep {
    pub id: String,
    pub message_id: String,
    pub content: String,
    pub source: String, // "llm" | "extended_thinking"
    pub display_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateThinkingStepRequest {
    pub message_id: String,
    pub content: String,
    pub source: Option<String>,
    pub display_order: Option<i32>,
}

/// Search decision - stores AI's reasoning about whether web search is needed
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SearchDecision {
    pub id: String,
    pub message_id: String,
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
    pub search_result_id: Option<String>, // Link to resulting search if approved
    pub display_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSearchDecisionRequest {
    pub message_id: String,
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
    pub search_result_id: Option<String>,
    pub display_order: Option<i32>,
}

/// Tool call - stores tool/function invocations (for MCP support)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ToolCall {
    pub id: String,
    pub message_id: String,
    pub tool_name: String,
    pub tool_input: Option<String>,  // JSON
    pub tool_output: Option<String>, // JSON
    pub status: String,              // "pending" | "running" | "success" | "error"
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub display_order: i32,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateToolCallRequest {
    pub message_id: String,
    pub tool_name: String,
    pub tool_input: Option<String>,
    pub tool_output: Option<String>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub display_order: Option<i32>,
    pub completed_at: Option<String>,
}

/// Code execution - stores code interpreter results
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CodeExecution {
    pub id: String,
    pub message_id: String,
    pub language: String,
    pub code: String,
    pub output: Option<String>,
    pub exit_code: Option<i32>,
    pub status: String, // "pending" | "running" | "success" | "error"
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub display_order: i32,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCodeExecutionRequest {
    pub message_id: String,
    pub language: String,
    pub code: String,
    pub output: Option<String>,
    pub exit_code: Option<i32>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub display_order: Option<i32>,
    pub completed_at: Option<String>,
}

/// Process step type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    Thinking,
    SearchDecision,
    ToolCall,
    CodeExecution,
}

impl std::fmt::Display for StepType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StepType::Thinking => write!(f, "thinking"),
            StepType::SearchDecision => write!(f, "search_decision"),
            StepType::ToolCall => write!(f, "tool_call"),
            StepType::CodeExecution => write!(f, "code_execution"),
        }
    }
}

impl std::str::FromStr for StepType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "thinking" => Ok(StepType::Thinking),
            "search_decision" => Ok(StepType::SearchDecision),
            "tool_call" => Ok(StepType::ToolCall),
            "code_execution" => Ok(StepType::CodeExecution),
            _ => Err(format!("Invalid step type: {}", s)),
        }
    }
}

/// Unified process step enum for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProcessStep {
    Thinking(ThinkingStep),
    SearchDecision(SearchDecision),
    ToolCall(ToolCall),
    CodeExecution(CodeExecution),
}

impl ProcessStep {
    pub fn id(&self) -> &str {
        match self {
            ProcessStep::Thinking(t) => &t.id,
            ProcessStep::SearchDecision(d) => &d.id,
            ProcessStep::ToolCall(t) => &t.id,
            ProcessStep::CodeExecution(c) => &c.id,
        }
    }

    pub fn step_type(&self) -> StepType {
        match self {
            ProcessStep::Thinking(_) => StepType::Thinking,
            ProcessStep::SearchDecision(_) => StepType::SearchDecision,
            ProcessStep::ToolCall(_) => StepType::ToolCall,
            ProcessStep::CodeExecution(_) => StepType::CodeExecution,
        }
    }
}
