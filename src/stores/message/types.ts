import type { Message, Conversation } from '@/types'
import type { Draft } from 'immer'

// Per-conversation state
export interface ConversationState {
  messages: Message[]
  isLoading: boolean
  isStreaming: boolean
  streamingContent: string
  // Streaming reasoning/thinking content from models like GPT-5, Gemini with thinking
  streamingReasoningContent: string
  // Whether reasoning has actually started (received first reasoning chunk)
  isReasoningActive: boolean
  isWaitingForAI: boolean
  attachmentStatus: 'idle' | 'processing' | 'complete' | 'error'
  // Counter that increments to force attachment refresh
  attachmentRefreshKey: number
  // Track URL fetch statuses for each message: { messageId: { url: status } }
  urlStatuses: Record<string, Record<string, 'fetching' | 'fetched'>>
  // Track pending search decisions per message: { messageId: true/false }
  pendingSearchDecisions: Record<string, boolean>
  // API error state - shown when LLM request fails
  apiError: string | null
}

// Default state for a new conversation
export const createDefaultConversationState = (): ConversationState => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: '',
  streamingReasoningContent: '',
  isReasoningActive: false,
  isWaitingForAI: false,
  attachmentStatus: 'idle',
  attachmentRefreshKey: 0,
  urlStatuses: {},
  pendingSearchDecisions: {},
  apiError: null,
})

// Message store state (without actions)
export interface MessageStoreState {
  // Record of conversationId -> state
  conversationStates: Record<string, ConversationState>

  // Global states
  isSending: boolean
  error: string | null

  // Callback for inter-store communication (avoids direct store imports)
  onNewConversationCreated?: (conversation: Conversation) => void | Promise<void>
}

// Selector actions
export interface MessageStoreSelectors {
  // Get state for specific conversation (creates if doesn't exist)
  getConversationState: (conversationId: string) => ConversationState
}

// Streaming-related actions
export interface MessageStoreStreamingActions {
  setStreamingContent: (conversationId: string, content: string) => void
  setIsStreaming: (conversationId: string, isStreaming: boolean) => void
  appendStreamingChunk: (conversationId: string, chunk: string) => void
  appendStreamingReasoningChunk: (conversationId: string, chunk: string) => void
  setIsWaitingForAI: (conversationId: string, isWaiting: boolean) => void
  setIsReasoningActive: (conversationId: string, isActive: boolean) => void
}

// Parameter overrides for conversation-level settings
export interface SendMessageParameterOverrides {
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

// CRUD actions (message create, read, update, delete, lifecycle)
export interface MessageStoreCrudActions {
  loadMessages: (conversationId: string) => Promise<void>
  sendMessage: (
    content: string,
    conversationId: string | null,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    includeHistory?: boolean,
    systemPrompt?: string,
    userPrompt?: string,
    modelDbId?: string,
    assistantDbId?: string,
    urlsToFetch?: string[],
    images?: { name: string; base64: string; mimeType: string }[],
    files?: { name: string; content: string; mimeType: string }[],
    searchEnabled?: boolean,
    parameterOverrides?: SendMessageParameterOverrides,
    contextMessageCount?: number | null,
    useProviderDefaults?: boolean
  ) => Promise<void>
  stopGeneration: (conversationId: string) => Promise<void>
  clearMessages: (conversationId: string) => Promise<void>
  addMessage: (conversationId: string, message: Message) => void
  setAttachmentStatus: (
    conversationId: string,
    status: 'idle' | 'processing' | 'complete' | 'error'
  ) => void
  incrementAttachmentRefreshKey: (conversationId: string) => void
  setApiError: (conversationId: string, error: string | null) => void
  clearApiError: (conversationId: string) => void
  cleanupConversation: (conversationId: string) => void
  removeConversationState: (conversationId: string) => void
}

// URL status actions
export interface MessageStoreUrlActions {
  setUrlStatuses: (conversationId: string, messageId: string, urls: string[]) => void
  markUrlFetched: (conversationId: string, messageId: string, url: string) => void
  clearUrlStatuses: (conversationId: string, messageId: string) => void
}

// Search decision actions
export interface MessageStoreSearchActions {
  setPendingSearchDecision: (conversationId: string, messageId: string, pending: boolean) => void
  clearPendingSearchDecisions: (conversationId: string) => void
}

// Combined actions type (for backwards compatibility)
export interface MessageStoreActions
  extends MessageStoreCrudActions,
    MessageStoreUrlActions,
    MessageStoreSearchActions {}

// Combined message store type
export interface MessageStore
  extends MessageStoreState,
    MessageStoreSelectors,
    MessageStoreStreamingActions,
    MessageStoreActions {}

// Maximum messages to keep in memory to prevent memory leaks
export const MAX_MESSAGES_IN_MEMORY = 100

// Helper types for action creators
export type ImmerSet = (
  nextStateOrUpdater: MessageStore | Partial<MessageStore> | ((state: Draft<MessageStore>) => void)
) => void
export type StoreGet = () => MessageStore
