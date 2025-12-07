import type { ImmerSet, StoreGet, MessageStoreSelectors } from './types'
import { createDefaultConversationState } from './types'

export const createSelectors = (set: ImmerSet, get: StoreGet): MessageStoreSelectors => ({
  getConversationState: (conversationId: string) => {
    const state = get()
    let convState = state.conversationStates[conversationId]

    if (!convState) {
      // Create new state for this conversation
      convState = createDefaultConversationState()
      set((draft) => {
        draft.conversationStates[conversationId] = convState!
      })
    }

    return convState
  },
})

