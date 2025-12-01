// Provider types
export interface Provider {
  id: string
  name: string
  provider_type: string // "ollama", "openai", "openrouter"
  api_key?: string
  base_url?: string
  description?: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface CreateProviderRequest {
  name: string
  provider_type: string
  api_key?: string
  base_url?: string
  description?: string
  is_enabled?: boolean
}

// Model (LLM) types
export interface Model {
  id: string
  name: string
  provider_id: string // Foreign key to providers table
  model_id: string
  description?: string
  is_starred: boolean // For quick access in chat interface
  is_deleted?: boolean // Soft delete flag
  created_at: string
  updated_at: string
}

export interface CreateModelRequest {
  name: string
  provider_id: string
  model_id: string
  description?: string
  is_starred?: boolean
}

// Assistant types
export interface Assistant {
  id: string
  name: string
  role?: string
  description?: string
  system_prompt: string
  user_prompt?: string
  model_id: string // Foreign key to models table
  avatar_type: string // "text" or "image"
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string
  group_name?: string
  is_starred: boolean
  created_at: string
  updated_at: string
}

export interface CreateAssistantRequest {
  name: string
  role?: string
  description?: string
  system_prompt: string
  user_prompt?: string
  model_id: string // Foreign key to models table
  avatar_type?: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string
  group_name?: string
  is_starred?: boolean
}

// Knowledge Base types
export interface KnowledgeBase {
  id: string
  name: string
  type: string // "document", "url", "file", "folder"
  content?: string
  url?: string
  metadata?: string
  created_at: string
  updated_at: string
}

export interface CreateKnowledgeBaseRequest {
  name: string
  type: string
  content?: string
  url?: string
  metadata?: string
}

// Tool types
export interface Tool {
  id: string
  name: string
  type: string // "server", "tool", "api"
  endpoint?: string
  config?: string
  description?: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface CreateToolRequest {
  name: string
  type: string
  endpoint?: string
  config?: string
  description?: string
  is_enabled?: boolean
}

// User types
export interface User {
  id: string
  username: string
  display_name: string
  email?: string
  avatar_type: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string
  is_self: boolean
  status: string // "active", "inactive", "deleted"
  last_seen_at?: string
  created_at: string
  updated_at: string
}

export interface CreateUserRequest {
  username: string
  display_name: string
  email?: string
  avatar_type?: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string
  is_self?: boolean
}

// User relationship types
export interface UserRelationship {
  id: string
  user_id: string
  related_user_id: string
  relationship_type: string // "friend", "blocked", "pending"
  created_at: string
  updated_at: string
}

export interface CreateUserRelationshipRequest {
  user_id: string
  related_user_id: string
  relationship_type: string
}

// Conversation types
export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  last_message?: string
}

export interface CreateConversationRequest {
  title: string
}

// Conversation participant types
export interface ConversationParticipant {
  id: string
  conversation_id: string
  participant_type: string // "user", "model", "assistant"
  participant_id?: string
  display_name?: string
  role: string // "owner", "admin", "member", "observer"
  status: string // "active", "left", "removed", "invited"
  joined_at: string
  left_at?: string
  last_read_at?: string
  metadata?: string
}

export interface CreateConversationParticipantRequest {
  conversation_id: string
  participant_type: string
  participant_id?: string
  display_name?: string
}

// Participant summary for UI display
export interface ParticipantSummary {
  participant_type: string
  participant_id?: string
  display_name: string
  avatar_type: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string
}

// Message types (thinking_content moved to ThinkingStep)
export interface Message {
  id: string
  conversation_id?: string
  sender_type: string
  sender_id?: string
  content: string
  tokens?: number
  created_at: string
}

export interface CreateMessageRequest {
  conversation_id?: string
  sender_type: string
  sender_id?: string
  content: string
  tokens?: number
}

// ==========================================================================
// CATEGORY 1: USER ATTACHMENTS (user-provided files and links)
// ==========================================================================

// File attachment - stores user uploaded file metadata (content in filesystem)
export interface FileAttachment {
  id: string
  file_name: string
  file_size: number
  mime_type: string
  storage_path: string // Path relative to attachments dir: "files/{uuid}.pdf"
  created_at: string
}

export interface CreateFileAttachmentRequest {
  file_name: string
  file_size: number
  mime_type: string
  storage_path: string
}

// User link - stores URL explicitly shared by user (not from search)
export interface UserLink {
  id: string
  url: string
  title?: string
  created_at: string
}

export interface CreateUserLinkRequest {
  url: string
  title?: string
}

// User attachment type enum
export type UserAttachmentType = 'file' | 'user_link'

// Unified user attachment type
export type UserAttachment =
  | ({ type: 'file' } & FileAttachment)
  | ({ type: 'user_link' } & UserLink)

// Helper type guards for user attachments
export function isFileAttachment(
  attachment: UserAttachment
): attachment is { type: 'file' } & FileAttachment {
  return attachment.type === 'file'
}

export function isUserLink(
  attachment: UserAttachment
): attachment is { type: 'user_link' } & UserLink {
  return attachment.type === 'user_link'
}

// ==========================================================================
// CATEGORY 2: CONTEXT ENRICHMENTS (system-fetched content)
// ==========================================================================

// Search result - stores web search metadata only (no content in filesystem)
export interface SearchResult {
  id: string
  query: string
  engine: string // "google" | "bing" | "duckduckgo"
  total_results?: number
  searched_at: string
  created_at: string
}

export interface CreateSearchResultRequest {
  query: string
  engine: string
  total_results?: number
  searched_at: string
}

// Fetch result - stores fetched web resource metadata (content in filesystem)
export interface FetchResult {
  id: string
  source_type: string // "search" | "user_link"
  source_id?: string // FK to search_results.id or user_links.id
  url: string
  title?: string
  description?: string
  storage_path: string // Path relative to attachments dir: "fetch/{uuid}.md"
  content_type: string // MIME type of stored content: "text/markdown", "text/plain"
  original_mime?: string // Original MIME type from HTTP response
  status: string // "pending" | "processing" | "success" | "failed"
  error?: string
  keywords?: string
  headings?: string // JSON array of headings
  original_size?: number
  processed_size?: number
  favicon_url?: string
  created_at: string
  updated_at: string
}

export interface CreateFetchResultRequest {
  source_type?: string
  source_id?: string
  url: string
  title?: string
  description?: string
  storage_path: string
  content_type: string
  original_mime?: string
  status?: string
  error?: string
  keywords?: string
  headings?: string
  original_size?: number
  processed_size?: number
  favicon_url?: string
}

// Context enrichment type enum
export type ContextType = 'search_result' | 'fetch_result'

// Unified context enrichment type
export type ContextEnrichment =
  | ({ type: 'search_result' } & SearchResult)
  | ({ type: 'fetch_result' } & FetchResult)

// Helper type guards for context enrichments
export function isSearchResult(
  context: ContextEnrichment
): context is { type: 'search_result' } & SearchResult {
  return context.type === 'search_result'
}

export function isFetchResult(
  context: ContextEnrichment
): context is { type: 'fetch_result' } & FetchResult {
  return context.type === 'fetch_result'
}

// ==========================================================================
// CATEGORY 3: PROCESS STEPS (AI workflow artifacts)
// ==========================================================================

// Thinking step - stores AI's reasoning/thinking process
export interface ThinkingStep {
  id: string
  content: string
  source: string // "llm" | "extended_thinking"
  created_at: string
}

export interface CreateThinkingStepRequest {
  content: string
  source?: string
}

// Search decision - stores AI's reasoning about whether web search is needed
export interface SearchDecision {
  id: string
  reasoning: string
  search_needed: boolean
  search_query?: string
  search_result_id?: string // Link to resulting search if approved
  created_at: string
}

export interface CreateSearchDecisionRequest {
  reasoning: string
  search_needed: boolean
  search_query?: string
  search_result_id?: string
}

// Tool call - stores tool/function invocations (for MCP support)
export interface ToolCall {
  id: string
  tool_name: string
  tool_input?: string // JSON
  tool_output?: string // JSON
  status: string // "pending" | "running" | "success" | "error"
  error?: string
  duration_ms?: number
  created_at: string
  completed_at?: string
}

export interface CreateToolCallRequest {
  tool_name: string
  tool_input?: string
  tool_output?: string
  status?: string
  error?: string
  duration_ms?: number
  completed_at?: string
}

// Code execution - stores code interpreter results
export interface CodeExecution {
  id: string
  language: string
  code: string
  output?: string
  exit_code?: number
  status: string // "pending" | "running" | "success" | "error"
  error?: string
  duration_ms?: number
  created_at: string
  completed_at?: string
}

export interface CreateCodeExecutionRequest {
  language: string
  code: string
  output?: string
  exit_code?: number
  status?: string
  error?: string
  duration_ms?: number
  completed_at?: string
}

// Process step type enum
export type StepType = 'thinking' | 'search_decision' | 'tool_call' | 'code_execution'

// Unified process step type
export type ProcessStep =
  | ({ type: 'thinking' } & ThinkingStep)
  | ({ type: 'search_decision' } & SearchDecision)
  | ({ type: 'tool_call' } & ToolCall)
  | ({ type: 'code_execution' } & CodeExecution)

// Helper type guards for process steps
export function isThinkingStep(step: ProcessStep): step is { type: 'thinking' } & ThinkingStep {
  return step.type === 'thinking'
}

export function isSearchDecision(
  step: ProcessStep
): step is { type: 'search_decision' } & SearchDecision {
  return step.type === 'search_decision'
}

export function isToolCall(step: ProcessStep): step is { type: 'tool_call' } & ToolCall {
  return step.type === 'tool_call'
}

export function isCodeExecution(
  step: ProcessStep
): step is { type: 'code_execution' } & CodeExecution {
  return step.type === 'code_execution'
}

// ==========================================================================
// MESSAGE RESOURCES (Combined Response)
// ==========================================================================

// All resources associated with a message
export interface MessageResources {
  attachments: UserAttachment[]
  contexts: ContextEnrichment[]
  steps: ProcessStep[]
}

// ==========================================================================
// LEGACY COMPATIBILITY (deprecated - use specific types above)
// ==========================================================================

// @deprecated Use UserAttachment, ContextEnrichment, or ProcessStep instead
export type Attachment = UserAttachment | ContextEnrichment | ProcessStep

// Prompt types
export interface Prompt {
  id: string
  name: string
  content: string
  description?: string
  category?: string
  is_system: boolean
  created_at: string
  updated_at: string
}

export interface CreatePromptRequest {
  name: string
  content: string
  description?: string
  category?: string
  is_system?: boolean
}

// Settings type
export interface Setting {
  key: string
  value: string
  updated_at: string
}

// Model info types
export interface ModelInfo {
  id: string
  name: string
  description?: string
  context_length?: number
  pricing?: ModelPricing
}

export interface ModelPricing {
  prompt?: number
  completion?: number
}

// Event payloads
export interface ChatStreamEvent {
  conversation_id: string
  content: string
}

export interface ChatCompleteEvent {
  conversation_id: string
  message: Message
}

export interface ChatErrorEvent {
  conversation_id: string
  error: string
}

export interface AttachmentProcessingStartedEvent {
  message_id: string
  conversation_id: string
  urls: string[]
}

export interface AttachmentProcessingCompleteEvent {
  message_id: string
  conversation_id: string
  attachment_ids: string[]
}

export interface AttachmentProcessingErrorEvent {
  message_id: string
  conversation_id: string
  attachment_id?: string
  error: string
}

export interface AttachmentUpdateEvent {
  message_id: string
  conversation_id: string
  completed_url?: string
  attachment?: {
    type: string
    id: string
    [key: string]: unknown
  }
}
