import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Model, Provider, CreateModelRequest } from '@/types'
import { logger } from '@/lib/logger'

interface ModelState {
  models: Model[]
  providers: Provider[]
  isLoading: boolean
  error: string | null

  loadModels: () => Promise<void>
  loadProviders: () => Promise<void>
  loadAll: () => Promise<void>
  updateModel: (id: string, req: CreateModelRequest) => Promise<Model>
  deleteModel: (id: string) => Promise<void>
  getModelById: (id: string) => Model | undefined
  getProviderById: (id: string) => Provider | undefined
}

export const useModelStore = create<ModelState>()(
  immer((set, get) => ({
    models: [],
    providers: [],
    isLoading: false,
    error: null,

    loadModels: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        // Use list_all_models to include soft-deleted models for display purposes
        const models = await invoke<Model[]>('list_all_models')
        logger.info('[modelStore] Loaded models:', models)
        set((draft) => {
          draft.models = models
          draft.isLoading = false
        })
      } catch (error) {
        logger.error('[modelStore] Failed to load models:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    loadProviders: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const providers = await invoke<Provider[]>('list_providers')
        logger.info('[modelStore] Loaded providers:', providers)
        set((draft) => {
          draft.providers = providers
          draft.isLoading = false
        })
      } catch (error) {
        logger.error('[modelStore] Failed to load providers:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    loadAll: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const [models, providers] = await Promise.all([
          // Use list_all_models to include soft-deleted models for display purposes
          invoke<Model[]>('list_all_models'),
          invoke<Provider[]>('list_providers'),
        ])
        logger.info('[modelStore] Loaded models:', models)
        logger.info('[modelStore] Loaded providers:', providers)
        set((draft) => {
          draft.models = models
          draft.providers = providers
          draft.isLoading = false
        })
      } catch (error) {
        logger.error('[modelStore] Failed to load models and providers:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    updateModel: async (id: string, req: CreateModelRequest) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const model = await invoke<Model>('update_model', { id, req })
        set((draft) => {
          const index = draft.models.findIndex((m: Model) => m.id === id)
          if (index >= 0) {
            draft.models[index] = model
          }
          draft.isLoading = false
        })
        return model
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    deleteModel: async (id: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        await invoke('soft_delete_model', { id })
        set((draft) => {
          const index = draft.models.findIndex((m: Model) => m.id === id)
          if (index >= 0) {
            draft.models[index].is_deleted = true
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

    getModelById: (id: string) => {
      return get().models.find((m) => m.id === id)
    },

    getProviderById: (id: string) => {
      return get().providers.find((p) => p.id === id)
    },
  }))
)
