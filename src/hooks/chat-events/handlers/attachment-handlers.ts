import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message'
import { logger } from '@/lib/logger'

/**
 * Handlers for attachment processing events
 */
export function useAttachmentHandlers() {
  const handleAttachmentProcessingStarted = useCallback(
    (convId: string, messageId: string, urls: string[]) => {
      const store = useMessageStore.getState()
      store.setAttachmentStatus(convId, 'processing')
      store.setUrlStatuses(convId, messageId, urls)
    },
    []
  )

  const handleAttachmentProcessingComplete = useCallback((convId: string, messageId: string) => {
    const store = useMessageStore.getState()
    store.setAttachmentStatus(convId, 'complete')
    store.clearUrlStatuses(convId, messageId)
  }, [])

  const handleAttachmentProcessingError = useCallback((convId: string, error: string) => {
    useMessageStore.getState().setAttachmentStatus(convId, 'error')
    logger.error('Attachment processing error:', error)
  }, [])

  const handleAttachmentUpdate = useCallback(
    (convId: string, messageId?: string, completedUrl?: string) => {
      const store = useMessageStore.getState()
      // Mark the completed URL as fetched
      if (messageId && completedUrl) {
        store.markUrlFetched(convId, messageId, completedUrl)
      }
      // Trigger a refresh by incrementing the refresh key
      store.incrementAttachmentRefreshKey(convId)
      // Clear pending search decision when actual decision arrives
      if (messageId) {
        store.setPendingSearchDecision(convId, messageId, false)
      }
    },
    []
  )

  return {
    handleAttachmentProcessingStarted,
    handleAttachmentProcessingComplete,
    handleAttachmentProcessingError,
    handleAttachmentUpdate,
  }
}
