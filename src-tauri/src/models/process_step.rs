use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;

// ==========================================================================
// PROCESS STEPS (AI workflow artifacts)
// ==========================================================================

/// Thinking step - stores AI's reasoning/thinking process
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct ThinkingStep {
    pub id: String,
    pub message_id: String,
    pub content: String,
    pub source: String, // "llm" | "extended_thinking"
    pub display_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateThinkingStepRequest {
    pub message_id: String,
    pub content: String,
    #[ts(optional)]
    pub source: Option<String>,
    #[ts(optional)]
    pub display_order: Option<i32>,
}

/// Search decision - stores AI's reasoning about whether web search is needed
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct SearchDecision {
    pub id: String,
    pub message_id: String,
    pub reasoning: String,
    pub search_needed: bool,
    #[ts(optional)]
    pub search_query: Option<String>,
    #[ts(optional)]
    pub search_result_id: Option<String>, // Link to resulting search if approved
    pub display_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateSearchDecisionRequest {
    pub message_id: String,
    pub reasoning: String,
    pub search_needed: bool,
    #[ts(optional)]
    pub search_query: Option<String>,
    #[ts(optional)]
    pub search_result_id: Option<String>,
    #[ts(optional)]
    pub display_order: Option<i32>,
}

/// Tool call - stores tool/function invocations (for MCP support)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct ToolCall {
    pub id: String,
    /// OpenAI Responses API `call_id`. Distinct from `id` (function-call item id).
    pub call_id: Option<String>,
    pub message_id: String,
    pub tool_name: String,
    #[ts(optional)]
    pub tool_input: Option<String>, // JSON
    #[ts(optional)]
    pub tool_output: Option<String>, // JSON
    pub status: String, // "pending" | "running" | "success" | "error"
    #[ts(optional)]
    pub error: Option<String>,
    #[ts(optional)]
    pub duration_ms: Option<i64>,
    pub display_order: i32,
    pub created_at: String,
    #[ts(optional)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateToolCallRequest {
    /// Use the model's original tool_call_id when available.
    pub id: Option<String>,
    /// OpenAI Responses API `call_id` for replaying tool history on follow-up turns.
    pub call_id: Option<String>,
    pub message_id: String,
    pub tool_name: String,
    #[ts(optional)]
    pub tool_input: Option<String>,
    #[ts(optional)]
    pub tool_output: Option<String>,
    #[ts(optional)]
    pub status: Option<String>,
    #[ts(optional)]
    pub error: Option<String>,
    #[ts(optional)]
    pub duration_ms: Option<i64>,
    #[ts(optional)]
    pub display_order: Option<i32>,
    #[ts(optional)]
    pub completed_at: Option<String>,
}

/// Code execution - stores code interpreter results
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct CodeExecution {
    pub id: String,
    pub message_id: String,
    pub language: String,
    pub code: String,
    #[ts(optional)]
    pub output: Option<String>,
    #[ts(optional)]
    pub exit_code: Option<i32>,
    pub status: String, // "pending" | "running" | "success" | "error"
    #[ts(optional)]
    pub error: Option<String>,
    #[ts(optional)]
    pub duration_ms: Option<i64>,
    pub display_order: i32,
    pub created_at: String,
    #[ts(optional)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateCodeExecutionRequest {
    pub message_id: String,
    pub language: String,
    pub code: String,
    #[ts(optional)]
    pub output: Option<String>,
    #[ts(optional)]
    pub exit_code: Option<i32>,
    #[ts(optional)]
    pub status: Option<String>,
    #[ts(optional)]
    pub error: Option<String>,
    #[ts(optional)]
    pub duration_ms: Option<i64>,
    #[ts(optional)]
    pub display_order: Option<i32>,
    #[ts(optional)]
    pub completed_at: Option<String>,
}

/// Content block - stores segmented content for interleaved display with tool calls
/// Used to properly show the order of agent work: thinking -> tool call -> response chunk
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, TS)]
#[ts(export)]
pub struct ContentBlock {
    pub id: String,
    pub message_id: String,
    pub content: String,
    pub display_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateContentBlockRequest {
    pub message_id: String,
    pub content: String,
    pub display_order: i32,
}

/// Process step type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    Thinking,
    SearchDecision,
    ToolCall,
    CodeExecution,
    ContentBlock,
}

impl std::fmt::Display for StepType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StepType::Thinking => write!(f, "thinking"),
            StepType::SearchDecision => write!(f, "search_decision"),
            StepType::ToolCall => write!(f, "tool_call"),
            StepType::CodeExecution => write!(f, "code_execution"),
            StepType::ContentBlock => write!(f, "content_block"),
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
            "content_block" => Ok(StepType::ContentBlock),
            _ => Err(format!("Invalid step type: {}", s)),
        }
    }
}

/// Unified process step enum for API responses
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProcessStep {
    Thinking(ThinkingStep),
    SearchDecision(SearchDecision),
    ToolCall(ToolCall),
    CodeExecution(CodeExecution),
    ContentBlock(ContentBlock),
}

impl ProcessStep {
    pub fn id(&self) -> &str {
        match self {
            ProcessStep::Thinking(t) => &t.id,
            ProcessStep::SearchDecision(d) => &d.id,
            ProcessStep::ToolCall(t) => &t.id,
            ProcessStep::CodeExecution(c) => &c.id,
            ProcessStep::ContentBlock(b) => &b.id,
        }
    }

    pub fn step_type(&self) -> StepType {
        match self {
            ProcessStep::Thinking(_) => StepType::Thinking,
            ProcessStep::SearchDecision(_) => StepType::SearchDecision,
            ProcessStep::ToolCall(_) => StepType::ToolCall,
            ProcessStep::CodeExecution(_) => StepType::CodeExecution,
            ProcessStep::ContentBlock(_) => StepType::ContentBlock,
        }
    }

    /// Get the display_order of this process step
    pub fn display_order(&self) -> i32 {
        match self {
            ProcessStep::Thinking(t) => t.display_order,
            ProcessStep::SearchDecision(d) => d.display_order,
            ProcessStep::ToolCall(t) => t.display_order,
            ProcessStep::CodeExecution(c) => c.display_order,
            ProcessStep::ContentBlock(b) => b.display_order,
        }
    }
}
