import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Provider, CreateProviderRequest } from '@/types'

interface ProviderStore {
  providers: Provider[]
  isLoading: boolean
  error: string | null

  loadProviders: () => Promise<void>
  createProvider: (req: CreateProviderRequest) => Promise<Provider>
  updateProvider: (id: string, req: CreateProviderRequest) => Promise<Provider>
  deleteProvider: (id: string) => Promise<void>
  getProviderById: (id: string) => Provider | undefined
}

export const useProviderStore = create<ProviderStore>()(
  immer((set, get) => ({
    providers: [],
    isLoading: false,
    error: null,

    loadProviders: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const providers = await invoke<Provider[]>('list_providers')
        set((draft) => {
          draft.providers = providers
          draft.isLoading = false
        })
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        console.error('Failed to load providers:', error)
      }
    },

    createProvider: async (req: CreateProviderRequest) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const provider = await invoke<Provider>('create_provider', { req })
        set((draft) => {
          draft.providers.push(provider)
          draft.isLoading = false
        })
        return provider
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    updateProvider: async (id: string, req: CreateProviderRequest) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const provider = await invoke<Provider>('update_provider', { id, req })
        set((draft) => {
          const index = draft.providers.findIndex((p: Provider) => p.id === id)
          if (index >= 0) {
            draft.providers[index] = provider
          }
          draft.isLoading = false
        })
        return provider
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    deleteProvider: async (id: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        await invoke('delete_provider', { id })
        set((draft) => {
          draft.providers = draft.providers.filter((p: Provider) => p.id !== id)
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

    getProviderById: (id: string) => {
      return get().providers.find((p) => p.id === id)
    },
  }))
)
