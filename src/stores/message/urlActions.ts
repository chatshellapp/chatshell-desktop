import type { ImmerSet, StoreGet, MessageStoreUrlActions } from './types'

export const createUrlActions = (set: ImmerSet, get: StoreGet): MessageStoreUrlActions => ({
  setUrlStatuses: (conversationId: string, messageId: string, urls: string[]) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        // Initialize all URLs with 'fetching' status
        convState.urlStatuses[messageId] = urls.reduce(
          (acc, url) => {
            acc[url] = 'fetching'
            return acc
          },
          {} as Record<string, 'fetching' | 'fetched'>
        )
      }
    })
  },

  markUrlFetched: (conversationId: string, messageId: string, url: string) => {
    get().getConversationState(conversationId)
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState && convState.urlStatuses[messageId]) {
        convState.urlStatuses[messageId][url] = 'fetched'
      }
    })
  },

  clearUrlStatuses: (conversationId: string, messageId: string) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        delete convState.urlStatuses[messageId]
      }
    })
  },
})
