import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message'
import { useConversationStore } from '@/stores/conversation'
import { logger } from '@/lib/logger'

/**
 * Handlers for conversation update and generation events
 */
export function useConversationHandlers() {
  const handleConversationUpdated = useCallback((conversationId: string, title: string) => {
    logger.info('[useChatEvents] Conversation title updated', { conversationId, title })
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
    logger.info('[useChatEvents] Generation stopped for conversation:', convId)
    // Stop spinners and clear auxiliary states. Keep streaming content visible briefly
    // until handleChatComplete arrives with the saved message from the backend.
    // Pending messages are processed in handleChatComplete (not here) to avoid
    // race conditions: chat-complete still fires after generation-stopped and
    // would reset isStreaming for the newly started send.
    const store = useMessageStore.getState()
    store.setIsStreaming(convId, false)
    store.setIsWaitingForAI(convId, false)
    store.clearPendingSearchDecisions(convId)
    store.setIsReasoningActive(convId, false)
  }, [])

  return {
    handleConversationUpdated,
    handleGenerationStopped,
  }
}
