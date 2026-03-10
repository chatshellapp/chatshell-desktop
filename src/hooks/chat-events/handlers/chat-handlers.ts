import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message'
import type { Message } from '@/types'
import { logger } from '@/lib/logger'

/**
 * Handlers for chat streaming, completion, and error events
 */
export function useChatHandlers() {
  const handleStreamChunk = useCallback((convId: string, chunk: string) => {
    logger.info('[useChatEvents] Appending chunk to conversation:', convId)
    useMessageStore.getState().appendStreamingChunk(convId, chunk)
  }, [])

  const handleStreamReasoningChunk = useCallback((convId: string, chunk: string) => {
    logger.info('[useChatEvents] Appending reasoning chunk to conversation:', convId)
    useMessageStore.getState().appendStreamingReasoningChunk(convId, chunk)
  }, [])

  const handleChatComplete = useCallback((convId: string, message: Message | null) => {
    logger.info('[useChatEvents] handleChatComplete called', { conversation: convId, message })
    const store = useMessageStore.getState()
    if (message) {
      const convState = store.getConversationState(convId)
      logger.info(
        '[useChatEvents] Current messages count for conversation:',
        convState.messages.length
      )
      store.addMessage(convId, message)
      logger.info(
        '[useChatEvents] After addMessage, messages count:',
        store.getConversationState(convId).messages.length
      )
    }
    store.setIsStreaming(convId, false)
    store.setStreamingContent(convId, '')
    store.clearStreamingToolCalls(convId)
    store.processNextPendingMessage(convId)
  }, [])

  const handleChatError = useCallback((convId: string, error: string) => {
    logger.info('[useChatEvents] handleChatError called', { conversation: convId, error })
    const store = useMessageStore.getState()
    store.setApiError(convId, error)
    store.setIsStreaming(convId, false)
    store.setStreamingContent(convId, '')
    store.clearStreamingToolCalls(convId)
    store.processNextPendingMessage(convId)
  }, [])

  const handleReasoningStarted = useCallback((convId: string) => {
    logger.info('[useChatEvents] Reasoning started for conversation:', convId)
    const store = useMessageStore.getState()
    store.setIsReasoningActive(convId, true)
  }, [])

  const handleStreamImage = useCallback((convId: string, imageUrl: string) => {
    logger.info('[useChatEvents] Received generated image for conversation:', convId)
    useMessageStore.getState().appendStreamingImage(convId, imageUrl)
  }, [])

  return {
    handleStreamChunk,
    handleStreamReasoningChunk,
    handleChatComplete,
    handleChatError,
    handleReasoningStarted,
    handleStreamImage,
  }
}
