import type { ImmerSet, StoreGet, MessageStoreSearchActions } from './types'

export const createSearchActions = (set: ImmerSet, get: StoreGet): MessageStoreSearchActions => ({
  setPendingSearchDecision: (conversationId: string, messageId: string, pending: boolean) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        if (pending) {
          convState.pendingSearchDecisions[messageId] = true
        } else {
          delete convState.pendingSearchDecisions[messageId]
        }
      }
    })
  },

  clearPendingSearchDecisions: (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.pendingSearchDecisions = {}
      }
    })
  },
})

