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

// Topic (Conversation) types
export interface Topic {
  id: string;
  assistant_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTopicRequest {
  assistant_id: string;
  title: string;
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

// MCP types
export interface Mcp {
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

export interface CreateMcpRequest {
  name: string;
  type: string;
  endpoint?: string;
  config?: string;
  description?: string;
  is_enabled?: boolean;
}

// Message types
export interface Message {
  id: string;
  topic_id: string;
  role: string;
  content: string;
  thinking_content?: string;
  scraped_content?: string;
  scraping_error?: string;
  tokens?: number;
  created_at: string;
}

export interface CreateMessageRequest {
  topic_id: string;
  role: string;
  content: string;
  thinking_content?: string;
  tokens?: number;
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
  topic_id: string;
  content: string;
}

export interface ChatCompleteEvent {
  topic_id: string;
  message: Message;
}

export interface ScrapingStartedEvent {
  message_id: string;
  topic_id: string;
}

export interface ScrapingCompleteEvent {
  message_id: string;
  topic_id: string;
  scraped_content: string;
}

export interface ScrapingErrorEvent {
  message_id: string;
  topic_id: string;
  error: string;
}

