import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message'

/**
 * Handlers for search decision events
 */
export function useSearchDecisionHandlers() {
  const handleSearchDecisionStarted = useCallback((convId: string, messageId: string) => {
    console.log('[useChatEvents] Search decision started for message:', messageId)
    const store = useMessageStore.getState()
    store.setPendingSearchDecision(convId, messageId, true)
  }, [])

  const handleSearchDecisionComplete = useCallback((convId: string, messageId: string) => {
    console.log('[useChatEvents] Search decision complete for message:', messageId)
    const store = useMessageStore.getState()
    // Trigger a refresh by incrementing the attachment refresh key
    // This will cause the UI to re-fetch resources and show the search decision
    // NOTE: We don't clear pending search decision here. The pending state is resolved
    // automatically when the resources are loaded and the search decision step exists.
    // This ensures the UI shows the search decision step BEFORE showing thinking/content.
    store.incrementAttachmentRefreshKey(convId)
  }, [])

  return {
    handleSearchDecisionStarted,
    handleSearchDecisionComplete,
  }
}

