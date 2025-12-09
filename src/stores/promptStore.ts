import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Prompt, CreatePromptRequest } from '@/types'
import { logger } from '@/lib/logger'

interface PromptState {
  prompts: Prompt[]
  isLoading: boolean
  error: string | null

  loadPrompts: () => Promise<void>
  ensureLoaded: () => Promise<void>
  loadPromptsByCategory: (category: string) => Promise<void>
  createPrompt: (req: CreatePromptRequest) => Promise<Prompt>
  updatePrompt: (id: string, req: CreatePromptRequest) => Promise<Prompt>
  deletePrompt: (id: string) => Promise<void>
  togglePromptStar: (id: string) => Promise<Prompt>
  getPromptById: (id: string) => Prompt | undefined
}

export const usePromptStore = create<PromptState>()(
  immer((set, get) => ({
    prompts: [],
    isLoading: false,
    error: null,

    loadPrompts: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const prompts = await invoke<Prompt[]>('list_prompts')
        logger.info('[promptStore] Loaded prompts:', prompts.length)
        set((draft) => {
          draft.prompts = prompts
          draft.isLoading = false
        })
      } catch (error) {
        logger.error('[promptStore] Failed to load prompts:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    // Ensures prompts are loaded - safe to call multiple times
    ensureLoaded: async () => {
      const state = get()
      if (state.prompts.length === 0 && !state.isLoading) {
        await get().loadPrompts()
      }
    },

    loadPromptsByCategory: async (category: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const prompts = await invoke<Prompt[]>('list_prompts_by_category', { category })
        logger.info('[promptStore] Loaded prompts for category', { category, count: prompts.length })
        set((draft) => {
          draft.prompts = prompts
          draft.isLoading = false
        })
      } catch (error) {
        logger.error('[promptStore] Failed to load prompts by category:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    createPrompt: async (req: CreatePromptRequest) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const prompt = await invoke<Prompt>('create_prompt', { req })
        set((draft) => {
          draft.prompts.push(prompt)
          draft.isLoading = false
        })
        return prompt
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    updatePrompt: async (id: string, req: CreatePromptRequest) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const prompt = await invoke<Prompt>('update_prompt', { id, req })
        set((draft) => {
          const index = draft.prompts.findIndex((p: Prompt) => p.id === id)
          if (index >= 0) {
            draft.prompts[index] = prompt
          }
          draft.isLoading = false
        })
        return prompt
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    deletePrompt: async (id: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        await invoke('delete_prompt', { id })
        set((draft) => {
          draft.prompts = draft.prompts.filter((p: Prompt) => p.id !== id)
          draft.isLoading = false
        })
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    togglePromptStar: async (id: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const prompt = await invoke<Prompt>('toggle_prompt_star', { id })
        set((draft) => {
          const index = draft.prompts.findIndex((p: Prompt) => p.id === id)
          if (index >= 0) {
            draft.prompts[index] = prompt
          }
          draft.isLoading = false
        })
        return prompt
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    getPromptById: (id: string) => {
      return get().prompts.find((p) => p.id === id)
    },
  }))
)
