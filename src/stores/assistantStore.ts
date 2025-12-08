import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Assistant, CreateAssistantRequest } from '@/types'
import { logger } from '@/lib/logger'

interface AssistantStore {
  assistants: Assistant[]
  currentAssistant: Assistant | null
  lastCreatedModelId: string | null
  isLoading: boolean
  error: string | null

  loadAssistants: () => Promise<void>
  createAssistant: (req: CreateAssistantRequest) => Promise<Assistant>
  updateAssistant: (id: string, req: CreateAssistantRequest) => Promise<Assistant>
  deleteAssistant: (id: string) => Promise<void>
  setCurrentAssistant: (assistant: Assistant | null) => void
  getAssistant: (id: string) => Promise<Assistant | null>
  getAssistantById: (id: string) => Assistant | undefined
}

export const useAssistantStore = create<AssistantStore>()(
  immer((set, get) => ({
    assistants: [],
    currentAssistant: null,
    lastCreatedModelId: null,
    isLoading: false,
    error: null,

    loadAssistants: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const assistants = await invoke<Assistant[]>('list_assistants')
        set((draft) => {
          draft.assistants = assistants
          draft.isLoading = false
        })
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        logger.error('Failed to load assistants:', error)
      }
    },

    createAssistant: async (req: CreateAssistantRequest) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const assistant = await invoke<Assistant>('create_assistant', { req })
        set((draft) => {
          draft.assistants.push(assistant)
          draft.lastCreatedModelId = assistant.model_id
          draft.isLoading = false
        })
        return assistant
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    updateAssistant: async (id: string, req: CreateAssistantRequest) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const assistant = await invoke<Assistant>('update_assistant', { id, req })
        set((draft) => {
          const index = draft.assistants.findIndex((a: Assistant) => a.id === id)
          if (index >= 0) {
            draft.assistants[index] = assistant
          }
          if (draft.currentAssistant?.id === id) {
            draft.currentAssistant = assistant
          }
          draft.isLoading = false
        })
        return assistant
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    deleteAssistant: async (id: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        await invoke('delete_assistant', { id })
        set((draft) => {
          draft.assistants = draft.assistants.filter((a: Assistant) => a.id !== id)
          if (draft.currentAssistant?.id === id) {
            draft.currentAssistant = null
          }
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

    setCurrentAssistant: (assistant: Assistant | null) => {
      // Note: No cleanup needed - messages are per-conversation, not per-assistant
      set((draft) => {
        draft.currentAssistant = assistant
      })
    },

    getAssistant: async (id: string) => {
      try {
        const assistant = await invoke<Assistant | null>('get_assistant', { id })
        return assistant
      } catch (error) {
        logger.error('Failed to get assistant:', error)
        return null
      }
    },

    getAssistantById: (id: string) => {
      return get().assistants.find((a) => a.id === id)
    },
  }))
)
