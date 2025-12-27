import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import type {
  Setting,
  ModelInfo,
  SearchProvider,
  SearchProviderId,
  WebFetchMode,
  WebFetchLocalMethod,
  WebFetchApiProvider,
  LogLevel,
} from '@/types'

interface SettingsStore {
  settings: Record<string, string>
  models: { [provider: string]: ModelInfo[] }
  searchProviders: SearchProvider[]
  isLoading: boolean
  error: string | null

  loadSettings: () => Promise<void>
  getSetting: (key: string) => Promise<string | null>
  saveSetting: (key: string, value: string) => Promise<void>
  fetchModels: (provider: string, apiKeyOrUrl?: string) => Promise<void>
  loadSearchProviders: () => Promise<void>
  getSearchProvider: () => Promise<SearchProviderId>
  setSearchProvider: (providerId: SearchProviderId) => Promise<void>

  // Web Fetch settings
  getWebFetchMode: () => Promise<WebFetchMode>
  setWebFetchMode: (mode: WebFetchMode) => Promise<void>
  getWebFetchLocalMethod: () => Promise<WebFetchLocalMethod>
  setWebFetchLocalMethod: (method: WebFetchLocalMethod) => Promise<void>
  getWebFetchApiProvider: () => Promise<WebFetchApiProvider>
  setWebFetchApiProvider: (provider: WebFetchApiProvider) => Promise<void>
  getJinaApiKey: () => Promise<string | null>
  setJinaApiKey: (key: string) => Promise<void>

  // Logging settings
  getLogLevelRust: () => Promise<LogLevel>
  setLogLevelRust: (level: LogLevel) => Promise<void>
  getLogLevelTypeScript: () => Promise<LogLevel>
  setLogLevelTypeScript: (level: LogLevel) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>()(
  immer((set, get) => ({
    settings: {},
    models: {},
    searchProviders: [],
    isLoading: false,
    error: null,

    loadSettings: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const settingsArray = await invoke<Setting[]>('get_all_settings')
        const settingsMap: Record<string, string> = {}
        settingsArray.forEach((setting) => {
          settingsMap[setting.key] = setting.value
        })
        set((draft) => {
          draft.settings = settingsMap
          draft.isLoading = false
        })
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        logger.error('Failed to load settings:', error)
      }
    },

    getSetting: async (key: string) => {
      try {
        const value = await invoke<string | null>('get_setting', { key })
        return value
      } catch (error) {
        logger.error('Failed to get setting:', error)
        return null
      }
    },

    saveSetting: async (key: string, value: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        await invoke('set_setting', { key, value })
        set((draft) => {
          draft.settings[key] = value
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

    fetchModels: async (provider: string, apiKeyOrUrl?: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        let models: ModelInfo[] = []

        if (provider === 'openai' && apiKeyOrUrl) {
          models = await invoke<ModelInfo[]>('fetch_openai_models', {
            apiKey: apiKeyOrUrl,
          })
        } else if (provider === 'openrouter' && apiKeyOrUrl) {
          models = await invoke<ModelInfo[]>('fetch_openrouter_models', {
            apiKey: apiKeyOrUrl,
          })
        } else if (provider === 'ollama') {
          const baseUrl = apiKeyOrUrl || 'http://localhost:11434'
          models = await invoke<ModelInfo[]>('fetch_ollama_models', {
            baseUrl,
          })
        }

        set((draft) => {
          draft.models[provider] = models
          draft.isLoading = false
        })
      } catch (error) {
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        logger.error('Failed to fetch models:', error)
        throw error
      }
    },

    loadSearchProviders: async () => {
      try {
        const providers = await invoke<SearchProvider[]>('get_search_providers')
        set((draft) => {
          draft.searchProviders = providers
        })
      } catch (error) {
        logger.error('Failed to load search providers:', error)
      }
    },

    getSearchProvider: async () => {
      const value = await get().getSetting('search_provider')
      return (value as SearchProviderId) || 'duckduckgo'
    },

    setSearchProvider: async (providerId: SearchProviderId) => {
      await get().saveSetting('search_provider', providerId)
    },

    // Web Fetch settings
    getWebFetchMode: async () => {
      const value = await get().getSetting('web_fetch_mode')
      return (value as WebFetchMode) || 'local'
    },

    setWebFetchMode: async (mode: WebFetchMode) => {
      await get().saveSetting('web_fetch_mode', mode)
    },

    getWebFetchLocalMethod: async () => {
      const value = await get().getSetting('web_fetch_local_method')
      return (value as WebFetchLocalMethod) || 'auto'
    },

    setWebFetchLocalMethod: async (method: WebFetchLocalMethod) => {
      await get().saveSetting('web_fetch_local_method', method)
    },

    getWebFetchApiProvider: async () => {
      const value = await get().getSetting('web_fetch_api_provider')
      return (value as WebFetchApiProvider) || 'jina'
    },

    setWebFetchApiProvider: async (provider: WebFetchApiProvider) => {
      await get().saveSetting('web_fetch_api_provider', provider)
    },

    getJinaApiKey: async () => {
      return await get().getSetting('jina_api_key')
    },

    setJinaApiKey: async (key: string) => {
      await get().saveSetting('jina_api_key', key)
    },

    // Logging settings
    getLogLevelRust: async () => {
      const value = await get().getSetting('log_level_rust')
      return (value as LogLevel) || 'info'
    },

    setLogLevelRust: async (level: LogLevel) => {
      await invoke('set_log_level', { level })
    },

    getLogLevelTypeScript: async () => {
      const value = await get().getSetting('log_level_typescript')
      return (value as LogLevel) || 'info'
    },

    setLogLevelTypeScript: async (level: LogLevel) => {
      await get().saveSetting('log_level_typescript', level)
      // Also update the logger
      const { logger } = await import('@/lib/logger')
      await logger.setLevel(level)
    },
  }))
)
