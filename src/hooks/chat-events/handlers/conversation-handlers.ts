import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message'
import { useConversationStore } from '@/stores/conversation'

/**
 * Handlers for conversation update and generation events
 */
export function useConversationHandlers() {
  const handleConversationUpdated = useCallback((conversationId: string, title: string) => {
    console.log('[useChatEvents] Conversation title updated:', conversationId, title)
    const conversationStore = useConversationStore.getState()

    // Update the conversation in the list
    const updatedConversations = conversationStore.conversations.map((conv) =>
      conv.id === conversationId ? { ...conv, title } : conv
    )

    // Update the store
    useConversationStore.setState({ conversations: updatedConversations })

    // If it's the current conversation, update that too
    if (conversationStore.currentConversation?.id === conversationId) {
      useConversationStore.setState({
        currentConversation: { ...conversationStore.currentConversation, title },
      })
    }
  }, [])

  const handleGenerationStopped = useCallback((convId: string) => {
    console.log('[useChatEvents] Generation stopped for conversation:', convId)
    // Reset streaming states when generation is stopped
    // This is needed when stopping before any content arrives,
    // as chat-complete event won't be emitted in that case
    const store = useMessageStore.getState()
    store.setIsStreaming(convId, false)
    store.setIsWaitingForAI(convId, false)
    store.setStreamingContent(convId, '')
    // Clear all pending search decisions for this conversation
    store.clearPendingSearchDecisions(convId)
    // Reset reasoning state
    store.setIsReasoningActive(convId, false)
  }, [])

  return {
    handleConversationUpdated,
    handleGenerationStopped,
  }
}

