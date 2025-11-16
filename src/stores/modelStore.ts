import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { Model, Provider } from '@/types'

interface ModelState {
  models: Model[]
  providers: Provider[]
  isLoading: boolean
  error: string | null
  
  loadModels: () => Promise<void>
  loadProviders: () => Promise<void>
  loadAll: () => Promise<void>
  getModelById: (id: string) => Model | undefined
  getProviderById: (id: string) => Provider | undefined
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  providers: [],
  isLoading: false,
  error: null,

  loadModels: async () => {
    set({ isLoading: true, error: null })
    try {
      const models = await invoke<Model[]>('list_models')
      console.log('[modelStore] Loaded models:', models)
      set({ models, isLoading: false })
    } catch (error) {
      console.error('[modelStore] Failed to load models:', error)
      set({ error: String(error), isLoading: false })
    }
  },

  loadProviders: async () => {
    set({ isLoading: true, error: null })
    try {
      const providers = await invoke<Provider[]>('list_providers')
      console.log('[modelStore] Loaded providers:', providers)
      set({ providers, isLoading: false })
    } catch (error) {
      console.error('[modelStore] Failed to load providers:', error)
      set({ error: String(error), isLoading: false })
    }
  },

  loadAll: async () => {
    set({ isLoading: true, error: null })
    try {
      const [models, providers] = await Promise.all([
        invoke<Model[]>('list_models'),
        invoke<Provider[]>('list_providers')
      ])
      console.log('[modelStore] Loaded models:', models)
      console.log('[modelStore] Loaded providers:', providers)
      set({ models, providers, isLoading: false })
    } catch (error) {
      console.error('[modelStore] Failed to load models and providers:', error)
      set({ error: String(error), isLoading: false })
    }
  },

  getModelById: (id: string) => {
    return get().models.find(m => m.id === id)
  },

  getProviderById: (id: string) => {
    return get().providers.find(p => p.id === id)
  },
}))

