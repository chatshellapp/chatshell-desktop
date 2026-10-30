import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useMessageStore } from '@/stores/message'
import { useRunFoldStore } from '@/stores/runFoldStore'
import type { Message } from '@/types'
import { toast } from 'sonner'
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

  const handleChatComplete = useCallback(
    (convId: string, message: Message | null, error?: string | null) => {
      logger.info('[useChatEvents] handleChatComplete called', { conversation: convId, message })
      const store = useMessageStore.getState()
      const { stopRequested } = store.getConversationState(convId)
      if (message) {
        store.addMessage(convId, message)
        // A reply that kept partial output after a failure or a stop gets a
        // session-only outcome; the saved row itself looks like any reply.
        if (error) {
          store.setRunOutcome(convId, message.id, { kind: 'failed', error })
        } else if (stopRequested) {
          store.setRunOutcome(convId, message.id, { kind: 'stopped' })
        }
        // A toggle on the live run fold carries over to the saved reply
        useRunFoldStore.getState().adoptLiveOverride(convId, message.id)
      } else {
        // Stopped before any output: nothing was saved
        store.failTurn(convId, 'stopped', null)
        useRunFoldStore.getState().clearLiveOverride(convId)
      }
      store.setIsStreaming(convId, false)
      store.setStreamingContent(convId, '')
      store.clearStreamingToolCalls(convId)
      if (message) {
        useMessageStore.setState((draft) => {
          const cs = draft.conversationStates[convId]
          if (cs) {
            cs.stopRequested = false
            cs.regenerateTargetId = null
          }
        })
      }
      // The completed turn may have created a sibling variant (resend or
      // regenerate): refresh the navigator's sibling groups. Fire-and-forget.
      void store.refreshSiblingGroups(convId)
      store.processNextPendingMessage(convId)
    },
    []
  )

  const handleChatError = useCallback((convId: string, error: string) => {
    logger.info('[useChatEvents] handleChatError called', { conversation: convId, error })
    const store = useMessageStore.getState()
    store.failTurn(convId, 'failed', error)
    useRunFoldStore.getState().clearLiveOverride(convId)
    store.clearStreamingToolCalls(convId)
    store.setIsStreaming(convId, false)
    // No-op while the failed turn pauses the queue
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

  const { t } = useTranslation('messages')

  // model_no_vision: images were stripped from the model's direct input;
  // attachments stay persisted and inspectable via the read tool.
  const handleChatWarning = useCallback(
    (convId: string, warning: string, images?: number) => {
      logger.info('[useChatEvents] Received chat warning:', { conversation: convId, warning })
      if (warning === 'model_no_vision' && (images ?? 0) > 0) {
        toast.info(t('imagesNotDirectlyViewable'), {
          description: t('imagesInspectViaReadTool'),
        })
      }
    },
    [t]
  )

  return {
    handleStreamChunk,
    handleStreamReasoningChunk,
    handleChatComplete,
    handleChatError,
    handleChatWarning,
    handleReasoningStarted,
    handleStreamImage,
  }
}
