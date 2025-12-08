import type { ImmerSet, StoreGet, MessageStoreStreamingActions } from './types'
import {
  THROTTLE_MS,
  pendingChunks,
  updateScheduled,
  updateTimeoutIds,
  pendingReasoningChunks,
  reasoningUpdateScheduled,
  reasoningUpdateTimeoutIds,
} from './throttle'

export const createStreamingActions = (
  set: ImmerSet,
  get: StoreGet
): MessageStoreStreamingActions => ({
  setStreamingContent: (conversationId: string, content: string) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.streamingContent = content
        // When clearing streaming content, also clear reasoning content
        if (content === '') {
          convState.streamingReasoningContent = ''
        }
      }
    })
  },

  setIsStreaming: (conversationId: string, isStreaming: boolean) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.isStreaming = isStreaming
        // Reset reasoning state when streaming ends
        if (!isStreaming) {
          convState.isReasoningActive = false
          convState.streamingReasoningContent = ''
        }
      }
    })
  },

  appendStreamingChunk: (conversationId: string, chunk: string) => {
    // Initialize arrays for this conversation if needed
    if (!pendingChunks.has(conversationId)) {
      pendingChunks.set(conversationId, [])
    }
    if (!updateScheduled.has(conversationId)) {
      updateScheduled.set(conversationId, false)
    }

    pendingChunks.get(conversationId)!.push(chunk)

    if (!updateScheduled.get(conversationId)) {
      updateScheduled.set(conversationId, true)

      // Clear any existing timeout to prevent leaks
      const existingTimeout = updateTimeoutIds.get(conversationId)
      if (existingTimeout !== undefined) {
        clearTimeout(existingTimeout)
      }

      // Use setTimeout for consistent throttling
      const timeoutId = setTimeout(() => {
        get().getConversationState(conversationId) // Ensure state exists
        const chunks = pendingChunks.get(conversationId) || []
        const allChunks = chunks.join('')
        pendingChunks.set(conversationId, [])
        updateScheduled.set(conversationId, false)
        updateTimeoutIds.delete(conversationId)

        set((draft) => {
          const convState = draft.conversationStates[conversationId]
          if (convState) {
            convState.streamingContent = convState.streamingContent + allChunks
            convState.isWaitingForAI = false
          }
        })
      }, THROTTLE_MS)

      updateTimeoutIds.set(conversationId, timeoutId)
    }
  },

  appendStreamingReasoningChunk: (conversationId: string, chunk: string) => {
    // Initialize arrays for this conversation if needed
    if (!pendingReasoningChunks.has(conversationId)) {
      pendingReasoningChunks.set(conversationId, [])
    }
    if (!reasoningUpdateScheduled.has(conversationId)) {
      reasoningUpdateScheduled.set(conversationId, false)
    }

    pendingReasoningChunks.get(conversationId)!.push(chunk)

    if (!reasoningUpdateScheduled.get(conversationId)) {
      reasoningUpdateScheduled.set(conversationId, true)

      // Clear any existing timeout to prevent leaks
      const existingTimeout = reasoningUpdateTimeoutIds.get(conversationId)
      if (existingTimeout !== undefined) {
        clearTimeout(existingTimeout)
      }

      // Use setTimeout for consistent throttling
      const timeoutId = setTimeout(() => {
        get().getConversationState(conversationId) // Ensure state exists
        const chunks = pendingReasoningChunks.get(conversationId) || []
        const allChunks = chunks.join('')
        pendingReasoningChunks.set(conversationId, [])
        reasoningUpdateScheduled.set(conversationId, false)
        reasoningUpdateTimeoutIds.delete(conversationId)

        set((draft) => {
          const convState = draft.conversationStates[conversationId]
          if (convState) {
            convState.streamingReasoningContent = convState.streamingReasoningContent + allChunks
            convState.isWaitingForAI = false
          }
        })
      }, THROTTLE_MS)

      reasoningUpdateTimeoutIds.set(conversationId, timeoutId)
    }
  },

  setIsWaitingForAI: (conversationId: string, isWaiting: boolean) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.isWaitingForAI = isWaiting
      }
    })
  },

  setIsReasoningActive: (conversationId: string, isActive: boolean) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.isReasoningActive = isActive
      }
    })
  },
})
