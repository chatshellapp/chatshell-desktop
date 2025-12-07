import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { MessageStore, ConversationState } from './types'
import { createDefaultConversationState } from './types'
import { createSelectors } from './selectors'
import { createStreamingActions } from './streaming'
import { createActions } from './actions'

export type { MessageStore, ConversationState }
export { createDefaultConversationState }

export const useMessageStore = create<MessageStore>()(
  immer((set, get) => ({
    // Initial state
    conversationStates: {},
    isSending: false,
    error: null,
    onNewConversationCreated: undefined,

    // Merge in selectors
    ...createSelectors(set, get),

    // Merge in streaming actions
    ...createStreamingActions(set, get),

    // Merge in main actions
    ...createActions(set, get),
  }))
)
