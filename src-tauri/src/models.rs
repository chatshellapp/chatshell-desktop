use serde::{Deserialize, Serialize};

// Provider models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,          // Display name, e.g., "Ollama Local", "OpenAI"
    pub provider_type: String, // Type: ollama, openai, openrouter
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub description: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProviderRequest {
    pub name: String,
    pub provider_type: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub description: Option<String>,
    pub is_enabled: Option<bool>,
}

// Model (LLM) models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub name: String,        // Display name, e.g., "DeepSeek R1 14B"
    pub provider_id: String, // Foreign key to providers table
    pub model_id: String,    // Actual model identifier, e.g., "deepseek-r1:14b"
    pub description: Option<String>,
    pub is_starred: bool, // Whether model is starred for quick access
    pub is_deleted: bool, // Soft delete flag
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateModelRequest {
    pub name: String,
    pub provider_id: String,
    pub model_id: String,
    pub description: Option<String>,
    pub is_starred: Option<bool>,
}

// ==========================================================================
// MODEL PARAMETERS - Reusable LLM generation configuration
// ==========================================================================

/// Model parameters for LLM configuration.
/// These parameters control the behavior of the language model during generation.
/// Can be used independently (for direct model calls) or embedded in an Assistant.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelParameters {
    /// Controls randomness in output (0.0 = deterministic, 2.0 = very random)
    pub temperature: Option<f64>,
    /// Maximum number of tokens to generate
    pub max_tokens: Option<i64>,
    /// Nucleus sampling: only consider tokens with top_p cumulative probability
    pub top_p: Option<f64>,
    /// Penalize tokens based on their frequency in the text so far
    pub frequency_penalty: Option<f64>,
    /// Penalize tokens that have already appeared in the text
    pub presence_penalty: Option<f64>,
    /// Additional provider-specific parameters (JSON)
    pub additional_params: Option<serde_json::Value>,
}

impl ModelParameters {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if any parameters are set (used to decide whether to use agent API)
    pub fn has_custom_params(&self) -> bool {
        self.temperature.is_some()
            || self.max_tokens.is_some()
            || self.top_p.is_some()
            || self.frequency_penalty.is_some()
            || self.presence_penalty.is_some()
            || self.additional_params.is_some()
    }

    /// Builder method for temperature
    pub fn with_temperature(mut self, temp: f64) -> Self {
        self.temperature = Some(temp);
        self
    }

    /// Builder method for max_tokens
    pub fn with_max_tokens(mut self, tokens: i64) -> Self {
        self.max_tokens = Some(tokens);
        self
    }

    /// Builder method for top_p
    pub fn with_top_p(mut self, top_p: f64) -> Self {
        self.top_p = Some(top_p);
        self
    }

    /// Builder method for frequency_penalty
    pub fn with_frequency_penalty(mut self, penalty: f64) -> Self {
        self.frequency_penalty = Some(penalty);
        self
    }

    /// Builder method for presence_penalty
    pub fn with_presence_penalty(mut self, penalty: f64) -> Self {
        self.presence_penalty = Some(penalty);
        self
    }

    /// Builder method for additional_params
    pub fn with_additional_params(mut self, params: serde_json::Value) -> Self {
        self.additional_params = Some(params);
        self
    }
}

// ==========================================================================
// ASSISTANT - Model + Parameters + System Prompt packaged together
// ==========================================================================

// Assistant models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assistant {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub description: Option<String>,
    pub system_prompt: String,
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    /// LLM generation parameters (flattened for JSON compatibility)
    #[serde(flatten)]
    pub model_params: ModelParameters,

    // Avatar fields
    pub avatar_type: String,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,

    pub group_name: Option<String>,
    pub is_starred: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAssistantRequest {
    pub name: String,
    pub role: Option<String>,
    pub description: Option<String>,
    pub system_prompt: String,
    pub user_prompt: Option<String>,
    pub model_id: String, // Foreign key to models table

    /// LLM generation parameters (flattened for JSON compatibility)
    #[serde(flatten)]
    pub model_params: Option<ModelParameters>,

    pub avatar_type: Option<String>,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,

    pub group_name: Option<String>,
    pub is_starred: Option<bool>,
}

// Knowledge Base models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeBase {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub content: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKnowledgeBaseRequest {
    pub name: String,
    pub r#type: String,
    pub content: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<String>,
}

// Tool models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub endpoint: Option<String>,
    pub config: Option<String>,
    pub description: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateToolRequest {
    pub name: String,
    pub r#type: String,
    pub endpoint: Option<String>,
    pub config: Option<String>,
    pub description: Option<String>,
    pub is_enabled: Option<bool>,
}

// User models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_type: String,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,
    pub is_self: bool,
    pub status: String,
    pub last_seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_type: Option<String>,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,
    pub is_self: Option<bool>,
}

// User relationship models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRelationship {
    pub id: String,
    pub user_id: String,
    pub related_user_id: String,
    pub relationship_type: String, // "friend", "blocked", "pending"
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRelationshipRequest {
    pub user_id: String,
    pub related_user_id: String,
    pub relationship_type: String,
}

// Conversation models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConversationRequest {
    pub title: String,
}

// Conversation participant models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationParticipant {
    pub id: String,
    pub conversation_id: String,
    pub participant_type: String, // "user", "model", "assistant"
    pub participant_id: Option<String>,
    pub display_name: Option<String>,
    pub role: String,   // "owner", "admin", "member", "observer"
    pub status: String, // "active", "left", "removed", "invited"
    pub joined_at: String,
    pub left_at: Option<String>,
    pub last_read_at: Option<String>,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConversationParticipantRequest {
    pub conversation_id: String,
    pub participant_type: String,
    pub participant_id: Option<String>,
    pub display_name: Option<String>,
}

// Participant summary for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantSummary {
    pub participant_type: String,
    pub participant_id: Option<String>,
    pub display_name: String,
    pub avatar_type: String,
    pub avatar_bg: Option<String>,
    pub avatar_text: Option<String>,
    pub avatar_image_path: Option<String>,
    pub avatar_image_url: Option<String>,
}

// Message models (thinking_content moved to thinking_steps table)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: Option<String>,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub content: String,
    pub tokens: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMessageRequest {
    pub conversation_id: Option<String>,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub content: String,
    pub tokens: Option<i64>,
}

// ==========================================================================
// CATEGORY 1: USER ATTACHMENTS (user-provided files and links)
// ==========================================================================

/// File attachment - stores metadata about a user-uploaded file
/// Content is stored in filesystem at storage_path
/// content_hash enables deduplication - same content shares storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAttachment {
    pub id: String,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub storage_path: String, // Path relative to attachments dir: "files/{hash}.pdf"
    pub content_hash: String, // Blake3 hash of file content
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFileAttachmentRequest {
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub storage_path: String,
    pub content_hash: String,
}

/// User link - stores URL explicitly shared by user (not from search)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserLink {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserLinkRequest {
    pub url: String,
    pub title: Option<String>,
}

/// User attachment type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UserAttachmentType {
    File,
    UserLink,
}

impl std::fmt::Display for UserAttachmentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserAttachmentType::File => write!(f, "file"),
            UserAttachmentType::UserLink => write!(f, "user_link"),
        }
    }
}

impl std::str::FromStr for UserAttachmentType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "file" => Ok(UserAttachmentType::File),
            "user_link" => Ok(UserAttachmentType::UserLink),
            _ => Err(format!("Invalid user attachment type: {}", s)),
        }
    }
}

/// Unified user attachment enum for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UserAttachment {
    File(FileAttachment),
    UserLink(UserLink),
}

impl UserAttachment {
    pub fn id(&self) -> &str {
        match self {
            UserAttachment::File(f) => &f.id,
            UserAttachment::UserLink(l) => &l.id,
        }
    }

    pub fn attachment_type(&self) -> UserAttachmentType {
        match self {
            UserAttachment::File(_) => UserAttachmentType::File,
            UserAttachment::UserLink(_) => UserAttachmentType::UserLink,
        }
    }
}

// ==========================================================================
// CATEGORY 2: CONTEXT ENRICHMENTS (system-fetched content)
// ==========================================================================

/// Search result - stores metadata about a web search operation
/// Content is not stored in filesystem, only metadata in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub query: String,
    pub engine: String, // "google" | "bing" | "duckduckgo"
    pub total_results: Option<i64>,
    pub searched_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSearchResultRequest {
    pub query: String,
    pub engine: String,
    pub total_results: Option<i64>,
    pub searched_at: String,
}

/// Fetch result - stores metadata about a fetched web resource
/// Content is stored in filesystem at storage_path
/// source_type distinguishes between search-initiated and user-link fetches
/// content_hash enables deduplication - same content shares storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchResult {
    pub id: String,
    pub source_type: String,       // "search" | "user_link"
    pub source_id: Option<String>, // FK to search_results.id or user_links.id
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub storage_path: String, // Path relative to attachments dir: "fetch/{hash}.md"
    pub content_type: String, // MIME type of stored content: "text/markdown", "text/plain"
    pub original_mime: Option<String>, // Original MIME type from HTTP response
    pub status: String,       // "pending" | "processing" | "success" | "failed"
    pub error: Option<String>,
    pub keywords: Option<String>,
    pub headings: Option<String>, // JSON array of headings
    pub original_size: Option<i64>,
    pub processed_size: Option<i64>,
    pub favicon_url: Option<String>,
    pub content_hash: Option<String>, // Blake3 hash of stored content for deduplication
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFetchResultRequest {
    pub source_type: Option<String>, // defaults to "search"
    pub source_id: Option<String>,
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub storage_path: String,
    pub content_type: String,
    pub original_mime: Option<String>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub keywords: Option<String>,
    pub headings: Option<String>,
    pub original_size: Option<i64>,
    pub processed_size: Option<i64>,
    pub favicon_url: Option<String>,
    pub content_hash: Option<String>,
}

/// Context enrichment type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ContextType {
    SearchResult,
    FetchResult,
}

impl std::fmt::Display for ContextType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContextType::SearchResult => write!(f, "search_result"),
            ContextType::FetchResult => write!(f, "fetch_result"),
        }
    }
}

impl std::str::FromStr for ContextType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "search_result" => Ok(ContextType::SearchResult),
            "fetch_result" => Ok(ContextType::FetchResult),
            _ => Err(format!("Invalid context type: {}", s)),
        }
    }
}

/// Unified context enrichment enum for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContextEnrichment {
    SearchResult(SearchResult),
    FetchResult(FetchResult),
}

impl ContextEnrichment {
    pub fn id(&self) -> &str {
        match self {
            ContextEnrichment::SearchResult(s) => &s.id,
            ContextEnrichment::FetchResult(f) => &f.id,
        }
    }

    pub fn context_type(&self) -> ContextType {
        match self {
            ContextEnrichment::SearchResult(_) => ContextType::SearchResult,
            ContextEnrichment::FetchResult(_) => ContextType::FetchResult,
        }
    }
}

// ==========================================================================
// CATEGORY 3: PROCESS STEPS (AI workflow artifacts)
// ==========================================================================

/// Thinking step - stores AI's reasoning/thinking process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingStep {
    pub id: String,
    pub content: String,
    pub source: String, // "llm" | "extended_thinking"
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateThinkingStepRequest {
    pub content: String,
    pub source: Option<String>,
}

/// Search decision - stores AI's reasoning about whether web search is needed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDecision {
    pub id: String,
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
    pub search_result_id: Option<String>, // Link to resulting search if approved
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSearchDecisionRequest {
    pub reasoning: String,
    pub search_needed: bool,
    pub search_query: Option<String>,
    pub search_result_id: Option<String>,
}

/// Tool call - stores tool/function invocations (for MCP support)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub tool_name: String,
    pub tool_input: Option<String>,  // JSON
    pub tool_output: Option<String>, // JSON
    pub status: String,              // "pending" | "running" | "success" | "error"
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateToolCallRequest {
    pub tool_name: String,
    pub tool_input: Option<String>,
    pub tool_output: Option<String>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub completed_at: Option<String>,
}

/// Code execution - stores code interpreter results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeExecution {
    pub id: String,
    pub language: String,
    pub code: String,
    pub output: Option<String>,
    pub exit_code: Option<i32>,
    pub status: String, // "pending" | "running" | "success" | "error"
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCodeExecutionRequest {
    pub language: String,
    pub code: String,
    pub output: Option<String>,
    pub exit_code: Option<i32>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
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

// ==========================================================================
// MESSAGE RESOURCES (Combined Response)
// ==========================================================================

/// All resources associated with a message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageResources {
    pub attachments: Vec<UserAttachment>,
    pub contexts: Vec<ContextEnrichment>,
    pub steps: Vec<ProcessStep>,
}

// Prompt models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub id: String,
    pub name: String,
    pub content: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_system: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePromptRequest {
    pub name: String,
    pub content: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub is_system: Option<bool>,
}

// Settings model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}
