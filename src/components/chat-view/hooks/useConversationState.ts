import { useEffect } from 'react'
import { useConversationStore } from '@/stores/conversation'
import { useMessageStore, type MessageStore } from '@/stores/message'
import { useChatEvents } from '@/hooks/chat-events'
import type { Message, UrlStatus } from '@/types'
import type { PendingMessage } from '@/stores/message/types'

// Stable fallbacks so per-field selectors never produce new references and
// consumers can rely on reference equality.
const EMPTY_MESSAGES: Message[] = []
const EMPTY_URL_STATUSES: Record<string, Record<string, UrlStatus>> = {}
const EMPTY_PENDING_DECISIONS: Record<string, boolean> = {}
const EMPTY_PENDING_MESSAGES: PendingMessage[] = []

/**
 * Low-frequency conversation state for ChatView.
 *
 * Every field is selected individually: the conversation-state object is
 * recreated by immer on every throttled streaming tick, so subscribing to
 * the object (or to per-token fields like streamingContent) would re-render
 * the whole view ~20x/second. High-frequency streaming fields live in
 * useStreamingState (subscribed only by the streaming row), except
 * hasStreamingData, which is a boolean here and only flips on transitions.
 */
export function useConversationState() {
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)

  const conversationId = currentConversation?.id ?? null
  const conv = (state: MessageStore) =>
    conversationId ? state.conversationStates[conversationId] : undefined

  const messages = useMessageStore((state) => conv(state)?.messages ?? EMPTY_MESSAGES)
  const hasOlderMessages = useMessageStore((state) => conv(state)?.hasOlderMessages ?? false)
  const isLoadingOlder = useMessageStore((state) => conv(state)?.isLoadingOlder ?? false)
  const isLoading = useMessageStore((state) => conv(state)?.isLoading ?? false)
  const isStreaming = useMessageStore((state) => conv(state)?.isStreaming ?? false)
  const isWaitingForAI = useMessageStore((state) => conv(state)?.isWaitingForAI ?? false)
  const attachmentStatus = useMessageStore(
    (state) => conv(state)?.attachmentStatus ?? ('idle' as const)
  )
  const attachmentRefreshKey = useMessageStore((state) => conv(state)?.attachmentRefreshKey ?? 0)
  const urlStatuses = useMessageStore((state) => conv(state)?.urlStatuses ?? EMPTY_URL_STATUSES)
  const pendingSearchDecisions = useMessageStore(
    (state) => conv(state)?.pendingSearchDecisions ?? EMPTY_PENDING_DECISIONS
  )
  const apiError = useMessageStore((state) => conv(state)?.apiError ?? null)
  const pendingMessages = useMessageStore(
    (state) => conv(state)?.pendingMessages ?? EMPTY_PENDING_MESSAGES
  )
  // Boolean view of the streaming buffers: re-renders only when streaming
  // data appears or is cleared, not on every token.
  const hasStreamingData = useMessageStore((state) => {
    const cs = conv(state)
    if (!cs) return false
    return !!(
      cs.streamingContent ||
      cs.streamingReasoningContent ||
      Object.keys(cs.streamingToolCalls).length > 0 ||
      cs.streamingImages.length > 0
    )
  })

  const loadMessages = useMessageStore((state) => state.loadMessages)
  const clearApiError = useMessageStore((state) => state.clearApiError)

  // Set up event listeners for chat streaming and scraping
  useChatEvents(conversationId)

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id)
    }
  }, [currentConversation, loadMessages])

  const handleClearApiError = () => {
    if (currentConversation) {
      clearApiError(currentConversation.id)
    }
  }

  return {
    // Conversation info
    currentConversation,
    conversationId,
    selectedModel,
    selectedAssistant,

    // Message window state (low frequency)
    messages,
    hasOlderMessages,
    isLoadingOlder,
    isLoading,
    isStreaming,
    isWaitingForAI,
    hasStreamingData,
    apiError,

    // Attachment state
    attachmentStatus,
    attachmentRefreshKey,
    urlStatuses,
    pendingSearchDecisions,
    pendingMessages,

    // Actions
    handleClearApiError,
  }
}
