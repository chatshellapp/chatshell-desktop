import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'

interface InputHistoryStore {
  /** Newest-first sent prompts, mirrored from the backend */
  history: string[]
  isLoaded: boolean
  /** Idempotent backend load; call once per app session */
  ensureLoaded: () => Promise<void>
  /** Record a sent prompt: optimistic move-to-front update + fire-and-forget persist */
  addEntry: (text: string) => void
}

export const useInputHistoryStore = create<InputHistoryStore>()(
  immer((set, get) => ({
    history: [],
    isLoaded: false,

    ensureLoaded: async () => {
      if (get().isLoaded) return
      set((draft) => {
        draft.isLoaded = true
      })
      try {
        const history = await invoke<string[]>('get_prompt_history')
        set((draft) => {
          draft.history = history
        })
      } catch (error) {
        set((draft) => {
          draft.isLoaded = false
        })
        logger.error('Failed to load prompt history:', error)
      }
    },

    addEntry: (text) => {
      const content = text.trim()
      if (!content) return

      set((draft) => {
        draft.history = [content, ...draft.history.filter((item) => item !== content)]
      })

      invoke('add_prompt_history_entry', { content }).catch((error) => {
        // Best-effort feature: log and keep the optimistic update
        logger.error('Failed to persist prompt history entry:', error)
      })
    },
  }))
)
