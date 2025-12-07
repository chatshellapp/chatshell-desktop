import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Prompt, CreatePromptRequest } from '@/types'

interface PromptState {
  prompts: Prompt[]
  isLoading: boolean
  error: string | null

  loadPrompts: () => Promise<void>
  ensureLoaded: () => Promise<void>
  loadPromptsByCategory: (category: string) => Promise<void>
  createPrompt: (req: CreatePromptRequest) => Promise<Prompt>
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
        console.log('[promptStore] Loaded prompts:', prompts.length)
        set((draft) => {
          draft.prompts = prompts
          draft.isLoading = false
        })
      } catch (error) {
        console.error('[promptStore] Failed to load prompts:', error)
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
        console.log('[promptStore] Loaded prompts for category:', category, prompts.length)
        set((draft) => {
          draft.prompts = prompts
          draft.isLoading = false
        })
      } catch (error) {
        console.error('[promptStore] Failed to load prompts by category:', error)
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

    getPromptById: (id: string) => {
      return get().prompts.find((p) => p.id === id)
    },
  }))
)
