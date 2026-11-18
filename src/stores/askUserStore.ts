// Pending `ask_user` requests: questions the model asks the user mid-turn,
// fed by `ask-user-requested` / `ask-user-resolved`. A FIFO queue across
// conversations: the dialog shows the oldest. RAM only.

import { create } from 'zustand'

/** One option, as validated by the backend (ids are runtime-assigned). */
export interface AskUserOption {
  id: string
  label: string
  description?: string | null
  recommended: boolean
}

/** One question. No options means a free-text question. */
export interface AskUserQuestion {
  id: string
  question: string
  header?: string | null
  multi: boolean
  options: AskUserOption[]
}

export interface AskUserRequest {
  requestId: string
  conversationId: string
  questions: AskUserQuestion[]
}

/** What the user entered for one question (sent to `resolve_ask_user`). */
export interface AskUserAnswer {
  question_id: string
  selected: string[]
  text: string | null
}

interface AskUserState {
  pending: AskUserRequest[]
  show: (request: AskUserRequest) => void
  remove: (requestId: string) => void
  reset: () => void
}

export const useAskUserStore = create<AskUserState>()((set) => ({
  pending: [],
  show: (request) =>
    set((state) =>
      state.pending.some((p) => p.requestId === request.requestId)
        ? state
        : { pending: [...state.pending, request] }
    ),
  remove: (requestId) =>
    set((state) => ({ pending: state.pending.filter((p) => p.requestId !== requestId) })),
  reset: () => set({ pending: [] }),
}))
