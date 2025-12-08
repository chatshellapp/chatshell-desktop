import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ConversationStore } from './types'
import { createSelectors } from './selectors'
import { createActions } from './actions'

export type { ConversationStore }

export const useConversationStore = create<ConversationStore>()(
  immer((set, get) => ({
    // Initial state
    conversations: [],
    currentConversation: null,
    currentParticipants: [],
    selectedModel: null,
    selectedAssistant: null,
    lastUsedModel: null,
    lastUsedAssistant: null,
    isFirstConversationSinceStartup: true,
    isLoading: false,
    error: null,

    // Merge in selectors
    ...createSelectors(set, get),

    // Merge in main actions
    ...createActions(set, get),
  }))
)
