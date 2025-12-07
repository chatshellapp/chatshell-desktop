import type { StoreGet, ConversationStoreSelectors } from './types'

export const createSelectors = (_set: unknown, get: StoreGet): ConversationStoreSelectors => ({
  getCurrentModel: () => {
    const state = get()
    // If assistant is selected, return its model (would need to fetch from modelStore)
    // If model is selected, return it directly
    return state.selectedModel
  },
})

