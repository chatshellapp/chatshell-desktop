import { create } from 'zustand'

/** Fold key of the live (streaming) run of a conversation. */
export const liveRunFoldKey = (conversationId: string) => `live:${conversationId}`

interface RunFoldState {
  // Manual expand/collapse per run (message id, or the live key). Session
  // only: reopening the app restores the defaults.
  overrides: Record<string, boolean>
  setExpanded: (key: string, expanded: boolean) => void
  // The live run was saved as `messageId`: its toggle carries over.
  adoptLiveOverride: (conversationId: string, messageId: string) => void
  // The live run ended without a saved reply.
  clearLiveOverride: (conversationId: string) => void
}

export const useRunFoldStore = create<RunFoldState>()((set) => ({
  overrides: {},
  setExpanded: (key, expanded) =>
    set((state) => ({ overrides: { ...state.overrides, [key]: expanded } })),
  adoptLiveOverride: (conversationId, messageId) =>
    set((state) => {
      const liveKey = liveRunFoldKey(conversationId)
      if (!(liveKey in state.overrides)) return state
      const { [liveKey]: live, ...rest } = state.overrides
      return { overrides: { ...rest, [messageId]: live } }
    }),
  clearLiveOverride: (conversationId) =>
    set((state) => {
      const liveKey = liveRunFoldKey(conversationId)
      if (!(liveKey in state.overrides)) return state
      const rest = { ...state.overrides }
      delete rest[liveKey]
      return { overrides: rest }
    }),
}))
