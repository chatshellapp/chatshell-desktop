// Provider types
export type { Provider, CreateProviderRequest } from './provider'

// Model types
export type {
  Model,
  CreateModelRequest,
  ModelParameters,
  ModelInfo,
  ModelPricing,
  ModelCapabilities,
} from './model'

// Model Parameter Preset types
export type {
  ModelParameterPreset,
  CreateModelParameterPresetRequest,
  UpdateModelParameterPresetRequest,
} from './model-parameter-preset'

// Assistant types
export type { Assistant, CreateAssistantRequest } from './assistant'

// Knowledge base types
export type { KnowledgeBase, CreateKnowledgeBaseRequest } from './knowledge-base'

// Tool types
export type {
  Tool,
  CreateToolRequest,
  McpServerConfig,
  McpTransportType,
  McpAuthType,
  McpOAuthMetadata,
  ProbeResult,
} from './tool'
export {
  parseMcpConfig,
  getTransportType,
  isBuiltinTool,
  isMcpTool,
  sortBuiltinTools,
} from './tool'

// Skill types
export type { Skill, CreateSkillRequest } from './skill'
export { isBuiltinSkill, isUserSkill } from './skill'

// User types
export type {
  User,
  CreateUserRequest,
  UserRelationship,
  CreateUserRelationshipRequest,
} from './user'

// Conversation types
export type {
  Conversation,
  CreateConversationRequest,
  ConversationParticipant,
  CreateConversationParticipantRequest,
  ParticipantSummary,
} from './conversation'

// Message types
export type { Message, CreateMessageRequest } from './message'

// Attachment types (user attachments - files only)
export type {
  FileAttachment,
  CreateFileAttachmentRequest,
  UserAttachmentType,
  UserAttachment,
} from './attachment'
export { isFileAttachment } from './attachment'

// Context types (context enrichments)
export type {
  SearchResult,
  CreateSearchResultRequest,
  FetchResult,
  CreateFetchResultRequest,
  ContextType,
  ContextEnrichment,
} from './context'
export { isSearchResult, isFetchResult } from './context'

// Process step types
export type {
  ThinkingStep,
  CreateThinkingStepRequest,
  SearchDecision,
  CreateSearchDecisionRequest,
  ToolCall,
  CreateToolCallRequest,
  CodeExecution,
  CreateCodeExecutionRequest,
  StepType,
  ProcessStep,
} from './process-step'
export { isThinkingStep, isSearchDecision, isToolCall, isCodeExecution } from './process-step'

// Message resources
export type { MessageResources, Attachment } from './message-resources'

// Prompt types
export type { Prompt, CreatePromptRequest } from './prompt'

// Search types
export type {
  MessageSearchResult,
  ConversationSearchResult,
  SearchResults,
} from './search'

// Setting types
export type {
  Setting,
  SearchProvider,
  SearchProviderId,
  WebFetchMode,
  WebFetchLocalMethod,
  WebFetchApiProvider,
  LogLevel,
} from './setting'

// Event types
export type {
  ChatStreamEvent,
  ChatStreamReasoningEvent,
  ChatStreamImageEvent,
  ChatCompleteEvent,
  ChatErrorEvent,
  AttachmentProcessingStartedEvent,
  AttachmentProcessingCompleteEvent,
  AttachmentProcessingErrorEvent,
  AttachmentUpdateEvent,
  SearchDecisionCompleteEvent,
} from './event'

// URL status type (used in message store for tracking fetch status)
export type UrlStatus = 'fetching' | 'fetched'

// Conversation settings types
export type {
  ModelParameterOverrides,
  ConversationSettings,
  PromptMode,
  UpdateConversationSettingsRequest,
  ConversationSettingsResponse,
} from './conversation-settings'
export {
  createDefaultConversationSettings,
  fromBackendSettings,
  toBackendRequest,
  PARAMETER_LIMITS,
  getContextCountOptions,
} from './conversation-settings'
