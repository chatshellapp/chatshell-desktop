import type { Message, Conversation } from '@/types'
import type { Draft } from 'immer'

// Streaming tool call (before saved to DB)
export interface StreamingToolCall {
  id: string
  tool_name: string
  tool_input: string
  tool_output?: string
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled'
  error?: string
  // Order in which this tool call was received (for proper display ordering)
  order: number
  // Content that was accumulated before this tool call started
  // This allows proper interleaving during streaming display
  contentBefore?: string
  // Reasoning content that was accumulated before this tool call started
  // This allows proper interleaving of thinking blocks with tool calls
  reasoningBefore?: string
}

// A turn whose generation ended without a saved reply. Session-only: it is
// never persisted, so a blank assistant row can never sync.
export interface FailedTurn {
  // 'failed': provider/network error; 'stopped': the user stopped the
  // generation before any output.
  kind: 'failed' | 'stopped'
  error: string | null
  // The reply a failed regenerate replaced. The backend leaf is moved back
  // to it, and the failed turn offers to show it again.
  previousReplyId: string | null
}

// How a saved reply's run ended when it did not complete normally
// (partial output kept). Session-only.
export interface RunOutcome {
  kind: 'failed' | 'stopped'
  error?: string
}

// Per-conversation state
export interface ConversationState {
  // Tail window of loaded messages (see MESSAGES_PAGE_SIZE); grows upward
  // via loadOlderMessages and resets on loadMessages.
  messages: Message[]
  // Sibling variant groups (resend/regenerate alternates): parent id (or ''
  // for first-turn messages with no parent) -> ordered sibling message ids.
  siblingGroups: Record<string, string[]>
  // Whether older messages exist beyond the loaded window.
  hasOlderMessages: boolean
  // Whether an upward page load is in flight.
  isLoadingOlder: boolean
  isLoading: boolean
  isStreaming: boolean
  streamingContent: string
  // Streaming reasoning/thinking content from models with GPT-5, Gemini thinking
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
  // Generation that ended without a saved reply (see FailedTurn)
  failedTurn: FailedTurn | null
  // Saved replies whose run failed or was stopped: messageId -> outcome
  runOutcomes: Record<string, RunOutcome>
  // stopGeneration was requested for the current run
  stopRequested: boolean
  // The reply the current regenerate replaces (restored if it fails empty)
  regenerateTargetId: string | null
  // Track streaming tool calls (MCP): { toolCallId: StreamingToolCall }
  streamingToolCalls: Record<string, StreamingToolCall>
  // Track streaming generated images (base64 data URLs)
  streamingImages: string[]
  // Messages queued while AI is still streaming
  pendingMessages: PendingMessage[]
}

// Default state for a new conversation
export const createDefaultConversationState = (): ConversationState => ({
  messages: [],
  siblingGroups: {},
  hasOlderMessages: false,
  isLoadingOlder: false,
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
  failedTurn: null,
  runOutcomes: {},
  stopRequested: false,
  regenerateTargetId: null,
  streamingToolCalls: {},
  streamingImages: [],
  pendingMessages: [],
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
  // Image streaming actions
  appendStreamingImage: (conversationId: string, imageUrl: string) => void
  // Tool call streaming actions (MCP)
  addStreamingToolCall: (
    conversationId: string,
    toolCallId: string,
    toolName: string,
    toolInput: string
  ) => void
  updateStreamingToolCall: (conversationId: string, toolCallId: string, toolOutput: string) => void
  clearStreamingToolCalls: (conversationId: string) => void
}

// A message queued for sending while the AI is still streaming
export interface PendingMessage {
  content: string
  conversationId: string
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  apiStyle?: string
  includeHistory?: boolean
  systemPrompt?: string
  userPrompt?: string
  modelDbId?: string
  assistantDbId?: string
  urlsToFetch?: string[]
  images?: { name: string; base64: string; mimeType: string }[]
  files?: { name: string; content: string; mimeType: string }[]
  searchEnabled?: boolean
  parameterOverrides?: SendMessageParameterOverrides
  contextMessageCount?: number | null
  useProviderDefaults?: boolean
  reuseFetchResultIds?: string[]
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
  loadOlderMessages: (conversationId: string) => Promise<boolean>
  loadAllMessages: (conversationId: string) => Promise<void>
  ensureMessageLoaded: (conversationId: string, messageId: string) => Promise<void>
  sendMessage: (
    content: string,
    conversationId: string | null,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    apiStyle?: string,
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
    useProviderDefaults?: boolean,
    reuseFetchResultIds?: string[],
    siblingOfMessageId?: string,
    reuseAttachmentIds?: string[]
  ) => Promise<void>
  // Non-destructive resend: same as sendMessage but the new user message
  // becomes a sibling variant of `siblingOfMessageId`.
  resendMessage: (
    content: string,
    conversationId: string,
    siblingOfMessageId: string,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    apiStyle?: string,
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
    useProviderDefaults?: boolean,
    reuseFetchResultIds?: string[],
    reuseAttachmentIds?: string[]
  ) => Promise<void>
  // Regenerate an assistant reply as a sibling variant of the same user
  // message (backend rewinds the active leaf and re-runs generation).
  regenerateMessage: (
    conversationId: string,
    messageId: string,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    apiStyle?: string,
    systemPrompt?: string,
    userPrompt?: string,
    modelDbId?: string,
    assistantDbId?: string,
    parameterOverrides?: SendMessageParameterOverrides,
    contextMessageCount?: number | null,
    useProviderDefaults?: boolean,
    disableTools?: boolean
  ) => Promise<void>
  // Switch the active branch to the one containing the message.
  setActiveBranch: (conversationId: string, messageId: string) => Promise<void>
  // Re-fetch sibling variant groups without reloading the message window.
  refreshSiblingGroups: (conversationId: string) => Promise<void>
  stopGeneration: (conversationId: string) => Promise<void>
  clearMessages: (conversationId: string) => Promise<void>
  deleteMessagesFrom: (conversationId: string, messageId: string) => Promise<void>
  addMessage: (conversationId: string, message: Message) => void
  setAttachmentStatus: (
    conversationId: string,
    status: 'idle' | 'processing' | 'complete' | 'error'
  ) => void
  incrementAttachmentRefreshKey: (conversationId: string) => void
  // Record a generation that ended without a saved reply. A failure (not a
  // stop) pauses the send queue until the turn is retried or dismissed.
  failTurn: (conversationId: string, kind: FailedTurn['kind'], error: string | null) => void
  // Add a reply finished with a non-normal outcome
  setRunOutcome: (conversationId: string, messageId: string, outcome: RunOutcome) => void
  // Remove the failed turn and resume the send queue
  dismissFailedTurn: (conversationId: string) => void
  // Reload the window onto the restored previous reply and dismiss
  showPreviousReply: (conversationId: string) => Promise<void>
  cleanupConversation: (conversationId: string) => void
  removeConversationState: (conversationId: string) => void
  enqueueMessage: (conversationId: string, message: PendingMessage) => void
  removePendingMessage: (conversationId: string, index: number) => void
  processNextPendingMessage: (conversationId: string) => void
  clearPendingMessages: (conversationId: string) => void
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

// Chat window page size: the initial tail window and each upward page loaded
// by loadOlderMessages. The backend query enforces it (limit + cursor); the
// store holds only what the initial window plus user-driven upward pages
// have loaded, and loadMessages resets back to the tail window.
export const MESSAGES_PAGE_SIZE = 100

// Helper types for action creators
export type ImmerSet = (
  nextStateOrUpdater: MessageStore | Partial<MessageStore> | ((state: Draft<MessageStore>) => void)
) => void
export type StoreGet = () => MessageStore
