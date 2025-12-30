mod assistant;
mod attachment;
mod context;
mod conversation;
mod conversation_settings;
mod knowledge_base;
mod message;
mod message_resources;
mod model;
mod model_parameter_preset;
mod process_step;
mod prompt;
mod provider;
mod setting;
mod tool;
mod user;

// Provider
pub use provider::{CreateProviderRequest, Provider};

// Model and parameters
pub use model::{CreateModelRequest, Model, ModelParameters};

// Model Parameter Preset
pub use model_parameter_preset::{
    CreateModelParameterPresetRequest, ModelParameterPreset, UpdateModelParameterPresetRequest,
};

// Assistant
pub use assistant::{Assistant, CreateAssistantRequest};

// Knowledge Base
pub use knowledge_base::{CreateKnowledgeBaseRequest, KnowledgeBase};

// Tool
pub use tool::{CreateToolRequest, McpConfig, McpTransportType, Tool};

// User
pub use user::{CreateUserRelationshipRequest, CreateUserRequest, User, UserRelationship};

// Conversation
pub use conversation::{
    Conversation, ConversationParticipant, CreateConversationParticipantRequest,
    CreateConversationRequest, ParticipantSummary,
};

// Conversation Settings
pub use conversation_settings::{
    ConversationSettings, ModelParameterOverrides, PromptMode, UpdateConversationSettingsRequest,
};

// Message
pub use message::{CreateMessageRequest, Message};

// Attachments (user-provided files)
pub use attachment::{CreateFileAttachmentRequest, FileAttachment, UserAttachment};

// Context enrichments (system-fetched content)
pub use context::{
    ContextEnrichment, ContextType, CreateFetchResultRequest, CreateSearchResultRequest,
    FetchResult, SearchResult,
};

// Process steps (AI workflow artifacts)
pub use process_step::{
    CodeExecution, ContentBlock, CreateCodeExecutionRequest, CreateContentBlockRequest,
    CreateSearchDecisionRequest, CreateThinkingStepRequest, CreateToolCallRequest, ProcessStep,
    SearchDecision, StepType, ThinkingStep, ToolCall,
};

// Message resources
pub use message_resources::MessageResources;

// Prompt
pub use prompt::{CreatePromptRequest, Prompt};

// Setting
pub use setting::Setting;
