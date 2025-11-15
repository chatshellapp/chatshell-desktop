import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { Model } from '@/types'

interface ModelState {
  models: Model[]
  isLoading: boolean
  error: string | null
  
  loadModels: () => Promise<void>
  getModelById: (id: string) => Model | undefined
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
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

  getModelById: (id: string) => {
    return get().models.find(m => m.id === id)
  },
}))

