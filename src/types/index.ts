// Provider types
export interface Provider {
  id: string;
  name: string;
  provider_type: string; // "ollama", "openai", "openrouter"
  api_key?: string;
  base_url?: string;
  description?: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProviderRequest {
  name: string;
  provider_type: string;
  api_key?: string;
  base_url?: string;
  description?: string;
  is_enabled?: boolean;
}

// Model (LLM) types
export interface Model {
  id: string;
  name: string;
  provider_id: string; // Foreign key to providers table
  model_id: string;
  description?: string;
  is_starred: boolean; // For quick access in chat interface
  created_at: string;
  updated_at: string;
}

export interface CreateModelRequest {
  name: string;
  provider_id: string;
  model_id: string;
  description?: string;
  is_starred?: boolean;
}

// Assistant types
export interface Assistant {
  id: string;
  name: string;
  role?: string;
  description?: string;
  system_prompt: string;
  user_prompt?: string;
  model_id: string; // Foreign key to models table
  avatar_type: string; // "text" or "image"
  avatar_bg?: string;
  avatar_text?: string;
  avatar_image_path?: string;
  avatar_image_url?: string;
  group_name?: string;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAssistantRequest {
  name: string;
  role?: string;
  description?: string;
  system_prompt: string;
  user_prompt?: string;
  model_id: string; // Foreign key to models table
  avatar_type?: string;
  avatar_bg?: string;
  avatar_text?: string;
  avatar_image_path?: string;
  avatar_image_url?: string;
  group_name?: string;
  is_starred?: boolean;
}

// Knowledge Base types
export interface KnowledgeBase {
  id: string;
  name: string;
  type: string; // "document", "url", "file", "folder"
  content?: string;
  url?: string;
  metadata?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeBaseRequest {
  name: string;
  type: string;
  content?: string;
  url?: string;
  metadata?: string;
}

// Tool types
export interface Tool {
  id: string;
  name: string;
  type: string; // "server", "tool", "api"
  endpoint?: string;
  config?: string;
  description?: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateToolRequest {
  name: string;
  type: string;
  endpoint?: string;
  config?: string;
  description?: string;
  is_enabled?: boolean;
}

// User types
export interface User {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  avatar_type: string;
  avatar_bg?: string;
  avatar_text?: string;
  avatar_image_path?: string;
  avatar_image_url?: string;
  is_self: boolean;
  status: string; // "active", "inactive", "deleted"
  last_seen_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUserRequest {
  username: string;
  display_name: string;
  email?: string;
  avatar_type?: string;
  avatar_bg?: string;
  avatar_text?: string;
  avatar_image_path?: string;
  avatar_image_url?: string;
  is_self?: boolean;
}

// User relationship types
export interface UserRelationship {
  id: string;
  user_id: string;
  related_user_id: string;
  relationship_type: string; // "friend", "blocked", "pending"
  created_at: string;
  updated_at: string;
}

export interface CreateUserRelationshipRequest {
  user_id: string;
  related_user_id: string;
  relationship_type: string;
}

// Conversation types
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
}

export interface CreateConversationRequest {
  title: string;
}

// Conversation participant types
export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  participant_type: string; // "user", "model", "assistant"
  participant_id?: string;
  display_name?: string;
  role: string; // "owner", "admin", "member", "observer"
  status: string; // "active", "left", "removed", "invited"
  joined_at: string;
  left_at?: string;
  last_read_at?: string;
  metadata?: string;
}

export interface CreateConversationParticipantRequest {
  conversation_id: string;
  participant_type: string;
  participant_id?: string;
  display_name?: string;
}

// Participant summary for UI display
export interface ParticipantSummary {
  participant_type: string;
  participant_id?: string;
  display_name: string;
  avatar_type: string;
  avatar_bg?: string;
  avatar_text?: string;
  avatar_image_path?: string;
  avatar_image_url?: string;
}

// Message types
export interface Message {
  id: string;
  conversation_id?: string;
  sender_type: string;
  sender_id?: string;
  content: string;
  thinking_content?: string;
  tokens?: number;
  created_at: string;
}

export interface CreateMessageRequest {
  conversation_id?: string;
  sender_type: string;
  sender_id?: string;
  content: string;
  thinking_content?: string;
  tokens?: number;
}

// Attachment types
// origin: "web" | "local"
// attachment_type: "fetch_result" | "search_result" | "file"
export type AttachmentOrigin = "web" | "local";
export type AttachmentType = "fetch_result" | "search_result" | "file";

export interface Attachment {
  id: string;
  origin: AttachmentOrigin;
  attachment_type: AttachmentType;
  content_format?: string; // MIME type of extracted/converted content
  url?: string;
  file_path?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string; // Original MIME type from source
  title?: string;
  description?: string;
  content?: string; // Extracted text content
  thumbnail_path?: string;
  extraction_status: string; // "pending" | "processing" | "success" | "failed"
  extraction_error?: string;
  metadata?: string; // JSON string
  parent_id?: string; // For search_result children
  created_at: string;
  updated_at: string;
}

export interface CreateAttachmentRequest {
  origin: AttachmentOrigin;
  attachment_type: AttachmentType;
  content_format?: string;
  url?: string;
  file_path?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  title?: string;
  description?: string;
  content?: string;
  thumbnail_path?: string;
  extraction_status?: string;
  extraction_error?: string;
  metadata?: string;
  parent_id?: string;
}

// Metadata for web fetch results (parsed from metadata JSON)
export interface WebFetchMetadata {
  keywords?: string;
  headings: string[];
  fetched_at: string;
  original_length?: number;
  truncated: boolean;
}

// Metadata for web search results
export interface WebSearchMetadata {
  query: string;
  search_engine: string;
  total_results?: number;
  searched_at: string;
}

// Metadata for local files
export interface LocalFileMetadata {
  original_path?: string;
  last_modified?: string;
  page_count?: number; // For PDF/Office documents
  dimensions?: ImageDimensions; // For images
}

// Image dimensions
export interface ImageDimensions {
  width: number;
  height: number;
}

// Prompt types
export interface Prompt {
  id: string;
  name: string;
  content: string;
  description?: string;
  category?: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePromptRequest {
  name: string;
  content: string;
  description?: string;
  category?: string;
  is_system?: boolean;
}

// Settings type
export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

// Model info types
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: ModelPricing;
}

export interface ModelPricing {
  prompt?: number;
  completion?: number;
}

// Event payloads
export interface ChatStreamEvent {
  conversation_id: string;
  content: string;
}

export interface ChatCompleteEvent {
  conversation_id: string;
  message: Message;
}

export interface AttachmentProcessingStartedEvent {
  message_id: string;
  conversation_id: string;
  urls: string[];
}

export interface AttachmentProcessingCompleteEvent {
  message_id: string;
  conversation_id: string;
  attachment_ids: string[];
}

export interface AttachmentProcessingErrorEvent {
  message_id: string;
  conversation_id: string;
  attachment_id?: string;
  error: string;
}

