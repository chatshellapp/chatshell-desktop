mod assistant;
mod attachment;
mod context;
mod conversation;
mod knowledge_base;
mod message;
mod message_resources;
mod model;
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

// Assistant
pub use assistant::{Assistant, CreateAssistantRequest};

// Knowledge Base
pub use knowledge_base::{CreateKnowledgeBaseRequest, KnowledgeBase};

// Tool
pub use tool::{CreateToolRequest, Tool};

// User
pub use user::{CreateUserRelationshipRequest, CreateUserRequest, User, UserRelationship};

// Conversation
pub use conversation::{
    Conversation, ConversationParticipant, CreateConversationParticipantRequest,
    CreateConversationRequest, ParticipantSummary,
};

// Message
pub use message::{CreateMessageRequest, Message};

// Attachments (user-provided files and links)
pub use attachment::{
    CreateFileAttachmentRequest, CreateUserLinkRequest, FileAttachment, UserAttachment,
    UserAttachmentType, UserLink,
};

// Context enrichments (system-fetched content)
pub use context::{
    ContextEnrichment, ContextType, CreateFetchResultRequest, CreateSearchResultRequest,
    FetchResult, SearchResult,
};

// Process steps (AI workflow artifacts)
pub use process_step::{
    CodeExecution, CreateCodeExecutionRequest, CreateSearchDecisionRequest,
    CreateThinkingStepRequest, CreateToolCallRequest, ProcessStep, SearchDecision, StepType,
    ThinkingStep, ToolCall,
};

// Message resources
pub use message_resources::MessageResources;

// Prompt
pub use prompt::{CreatePromptRequest, Prompt};

// Setting
pub use setting::Setting;

