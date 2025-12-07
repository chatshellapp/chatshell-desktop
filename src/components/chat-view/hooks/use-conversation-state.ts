import { useEffect } from 'react'
import { useConversationStore } from '@/stores/conversation'
import { useMessageStore } from '@/stores/message'
import { useChatEvents } from '@/hooks/useChatEvents'

export function useConversationState() {
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)

  // Get conversation-specific state
  const conversationState = useMessageStore((state) =>
    currentConversation ? state.getConversationState(currentConversation.id) : null
  )

  const loadMessages = useMessageStore((state) => state.loadMessages)
  const clearApiError = useMessageStore((state) => state.clearApiError)

  // Extract values from conversation state with defaults
  const messages = conversationState?.messages || []
  const isStreaming = conversationState?.isStreaming || false
  const streamingContent = conversationState?.streamingContent || ''
  // Streaming reasoning content from API (GPT-5, Gemini with thinking)
  const streamingReasoningContent = conversationState?.streamingReasoningContent || ''
  // Whether reasoning has actually started (received first reasoning chunk)
  const isReasoningActive = conversationState?.isReasoningActive || false
  const attachmentStatus = conversationState?.attachmentStatus || 'idle'
  const attachmentRefreshKey = conversationState?.attachmentRefreshKey || 0
  const isWaitingForAI = conversationState?.isWaitingForAI || false
  const urlStatuses = conversationState?.urlStatuses || {}
  const pendingSearchDecisions = conversationState?.pendingSearchDecisions || {}
  const apiError = conversationState?.apiError || null

  // Set up event listeners for chat streaming and scraping
  useChatEvents(currentConversation?.id || null)

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
    conversationId: currentConversation?.id || null,
    selectedModel,
    selectedAssistant,

    // Message state
    messages,
    isStreaming,
    streamingContent,
    streamingReasoningContent,
    isReasoningActive,
    isWaitingForAI,
    apiError,

    // Attachment state
    attachmentStatus,
    attachmentRefreshKey,
    urlStatuses,
    pendingSearchDecisions,

    // Actions
    handleClearApiError,
  }
}

