import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '../settingsStore'
import type { Setting, SearchProvider } from '@/types'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
  },
}))

const mockInvoke = vi.mocked(invoke)

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to initial values
    useSettingsStore.setState({
      settings: {},
      models: {},
      searchProviders: [],
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have empty settings', () => {
      const state = useSettingsStore.getState()
      expect(state.settings).toEqual({})
    })

    it('should have empty models', () => {
      const state = useSettingsStore.getState()
      expect(state.models).toEqual({})
    })

    it('should not be loading initially', () => {
      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      const state = useSettingsStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('loadSettings', () => {
    it('should populate settings on successful load', async () => {
      const mockSettings: Setting[] = [
        { key: 'theme', value: 'dark', updated_at: '2024-01-01T00:00:00Z' },
        { key: 'language', value: 'en', updated_at: '2024-01-01T00:00:00Z' },
      ]
      mockInvoke.mockResolvedValue(mockSettings)

      await useSettingsStore.getState().loadSettings()

      expect(mockInvoke).toHaveBeenCalledWith('get_all_settings')
      expect(useSettingsStore.getState().settings).toEqual({
        theme: 'dark',
        language: 'en',
      })
      expect(useSettingsStore.getState().isLoading).toBe(false)
    })

    it('should set error on failed load', async () => {
      const errorMessage = 'Failed to load settings'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await useSettingsStore.getState().loadSettings()

      expect(useSettingsStore.getState().settings).toEqual({})
      expect(useSettingsStore.getState().isLoading).toBe(false)
      expect(useSettingsStore.getState().error).toContain(errorMessage)
    })
  })

  describe('getSetting', () => {
    it('should get setting value', async () => {
      mockInvoke.mockResolvedValue('dark')

      const value = await useSettingsStore.getState().getSetting('theme')

      expect(mockInvoke).toHaveBeenCalledWith('get_setting', { key: 'theme' })
      expect(value).toBe('dark')
    })

    it('should return null on error', async () => {
      mockInvoke.mockRejectedValue(new Error('Failed'))

      const value = await useSettingsStore.getState().getSetting('theme')

      expect(value).toBeNull()
    })
  })

  describe('saveSetting', () => {
    it('should save setting and update store', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().saveSetting('theme', 'light')

      expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'theme', value: 'light' })
      expect(useSettingsStore.getState().settings['theme']).toBe('light')
      expect(useSettingsStore.getState().isLoading).toBe(false)
    })

    it('should throw and set error on failure', async () => {
      const errorMessage = 'Failed to save setting'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await expect(useSettingsStore.getState().saveSetting('theme', 'light')).rejects.toThrow()

      expect(useSettingsStore.getState().error).toContain(errorMessage)
    })
  })

  describe('fetchModels', () => {
    it('should fetch OpenAI models', async () => {
      const mockModels = [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      ]
      mockInvoke.mockResolvedValue(mockModels)

      await useSettingsStore.getState().fetchModels('openai', 'sk-test-key')

      expect(mockInvoke).toHaveBeenCalledWith('fetch_openai_models', { apiKey: 'sk-test-key' })
      expect(useSettingsStore.getState().models['openai']).toEqual(mockModels)
    })

    it('should fetch OpenRouter models', async () => {
      const mockModels = [{ id: 'anthropic/claude-3', name: 'Claude 3' }]
      mockInvoke.mockResolvedValue(mockModels)

      await useSettingsStore.getState().fetchModels('openrouter', 'sk-or-test-key')

      expect(mockInvoke).toHaveBeenCalledWith('fetch_openrouter_models', {
        apiKey: 'sk-or-test-key',
      })
      expect(useSettingsStore.getState().models['openrouter']).toEqual(mockModels)
    })

    it('should fetch Ollama models with default URL', async () => {
      const mockModels = [{ id: 'llama2', name: 'Llama 2' }]
      mockInvoke.mockResolvedValue(mockModels)

      await useSettingsStore.getState().fetchModels('ollama')

      expect(mockInvoke).toHaveBeenCalledWith('fetch_ollama_models', {
        baseUrl: 'http://localhost:11434',
      })
      expect(useSettingsStore.getState().models['ollama']).toEqual(mockModels)
    })

    it('should fetch Ollama models with custom URL', async () => {
      const mockModels = [{ id: 'llama2', name: 'Llama 2' }]
      mockInvoke.mockResolvedValue(mockModels)

      await useSettingsStore.getState().fetchModels('ollama', 'http://custom:11434')

      expect(mockInvoke).toHaveBeenCalledWith('fetch_ollama_models', {
        baseUrl: 'http://custom:11434',
      })
    })

    it('should throw and set error on failure', async () => {
      const errorMessage = 'Failed to fetch models'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await expect(
        useSettingsStore.getState().fetchModels('openai', 'invalid-key')
      ).rejects.toThrow()

      expect(useSettingsStore.getState().error).toContain(errorMessage)
    })
  })

  describe('loadSearchProviders', () => {
    it('should load search providers', async () => {
      const mockProviders: SearchProvider[] = [
        { id: 'duckduckgo', name: 'DuckDuckGo' },
        { id: 'yahoo', name: 'Yahoo' },
      ]
      mockInvoke.mockResolvedValue(mockProviders)

      await useSettingsStore.getState().loadSearchProviders()

      expect(mockInvoke).toHaveBeenCalledWith('get_search_providers')
      expect(useSettingsStore.getState().searchProviders).toEqual(mockProviders)
    })
  })

  describe('getSearchProvider', () => {
    it('should return saved search provider', async () => {
      mockInvoke.mockResolvedValue('yahoo')

      const provider = await useSettingsStore.getState().getSearchProvider()

      expect(provider).toBe('yahoo')
    })

    it('should return duckduckgo as default', async () => {
      mockInvoke.mockResolvedValue(null)

      const provider = await useSettingsStore.getState().getSearchProvider()

      expect(provider).toBe('duckduckgo')
    })
  })

  describe('setSearchProvider', () => {
    it('should save search provider', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().setSearchProvider('yahoo')

      expect(mockInvoke).toHaveBeenCalledWith('set_setting', {
        key: 'search_provider',
        value: 'yahoo',
      })
    })
  })

  describe('Web Fetch settings', () => {
    it('should get web fetch mode with default', async () => {
      mockInvoke.mockResolvedValue(null)

      const mode = await useSettingsStore.getState().getWebFetchMode()

      expect(mode).toBe('local')
    })

    it('should get web fetch mode', async () => {
      mockInvoke.mockResolvedValue('api')

      const mode = await useSettingsStore.getState().getWebFetchMode()

      expect(mode).toBe('api')
    })

    it('should set web fetch mode', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().setWebFetchMode('api')

      expect(mockInvoke).toHaveBeenCalledWith('set_setting', {
        key: 'web_fetch_mode',
        value: 'api',
      })
    })

    it('should get web fetch local method with default', async () => {
      mockInvoke.mockResolvedValue(null)

      const method = await useSettingsStore.getState().getWebFetchLocalMethod()

      expect(method).toBe('auto')
    })

    it('should get web fetch API provider with default', async () => {
      mockInvoke.mockResolvedValue(null)

      const provider = await useSettingsStore.getState().getWebFetchApiProvider()

      expect(provider).toBe('jina')
    })
  })

  describe('Logging settings', () => {
    it('should get Rust log level with default', async () => {
      mockInvoke.mockResolvedValue(null)

      const level = await useSettingsStore.getState().getLogLevelRust()

      expect(level).toBe('info')
    })

    it('should get TypeScript log level with default', async () => {
      mockInvoke.mockResolvedValue(null)

      const level = await useSettingsStore.getState().getLogLevelTypeScript()

      expect(level).toBe('info')
    })

    it('should set Rust log level via invoke', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().setLogLevelRust('debug')

      expect(mockInvoke).toHaveBeenCalledWith('set_log_level', { level: 'debug' })
    })
  })
})
