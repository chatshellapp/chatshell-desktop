import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message'

/**
 * Handlers for chat streaming, completion, and error events
 */
export function useChatHandlers() {
  const handleStreamChunk = useCallback((convId: string, chunk: string) => {
    console.log('[useChatEvents] Appending chunk to conversation:', convId)
    useMessageStore.getState().appendStreamingChunk(convId, chunk)
  }, [])

  const handleStreamReasoningChunk = useCallback((convId: string, chunk: string) => {
    console.log('[useChatEvents] Appending reasoning chunk to conversation:', convId)
    useMessageStore.getState().appendStreamingReasoningChunk(convId, chunk)
  }, [])

  const handleChatComplete = useCallback((convId: string, message: any) => {
    console.log(
      '[useChatEvents] handleChatComplete called for conversation:',
      convId,
      'message:',
      message
    )
    const store = useMessageStore.getState()
    const convState = store.getConversationState(convId)
    console.log(
      '[useChatEvents] Current messages count for conversation:',
      convState.messages.length
    )
    store.addMessage(convId, message)
    console.log(
      '[useChatEvents] After addMessage, messages count:',
      store.getConversationState(convId).messages.length
    )
    store.setIsStreaming(convId, false)
    store.setStreamingContent(convId, '')
  }, [])

  const handleChatError = useCallback((convId: string, error: string) => {
    console.log('[useChatEvents] handleChatError called for conversation:', convId, 'error:', error)
    const store = useMessageStore.getState()
    store.setApiError(convId, error)
  }, [])

  const handleReasoningStarted = useCallback((convId: string) => {
    console.log('[useChatEvents] Reasoning started for conversation:', convId)
    const store = useMessageStore.getState()
    store.setIsReasoningActive(convId, true)
  }, [])

  return {
    handleStreamChunk,
    handleStreamReasoningChunk,
    handleChatComplete,
    handleChatError,
    handleReasoningStarted,
  }
}

