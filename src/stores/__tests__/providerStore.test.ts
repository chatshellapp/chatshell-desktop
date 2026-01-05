import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useProviderStore } from '../providerStore'
import type { Provider, CreateProviderRequest } from '@/types'

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
  },
}))

const mockInvoke = vi.mocked(invoke)

const createMockProvider = (id: string, name: string): Provider => ({
  id,
  name,
  provider_type: 'openai',
  base_url: 'https://api.openai.com/v1',
  is_enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

describe('useProviderStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to initial values
    useProviderStore.setState({
      providers: [],
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have empty providers array', () => {
      const state = useProviderStore.getState()
      expect(state.providers).toEqual([])
    })

    it('should not be loading initially', () => {
      const state = useProviderStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      const state = useProviderStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('loadProviders', () => {
    it('should populate providers on successful load', async () => {
      const mockProviders: Provider[] = [
        createMockProvider('provider-1', 'OpenAI'),
        createMockProvider('provider-2', 'Anthropic'),
      ]
      mockInvoke.mockResolvedValue(mockProviders)

      await useProviderStore.getState().loadProviders()

      expect(mockInvoke).toHaveBeenCalledWith('list_providers')
      expect(useProviderStore.getState().providers).toEqual(mockProviders)
      expect(useProviderStore.getState().isLoading).toBe(false)
      expect(useProviderStore.getState().error).toBeNull()
    })

    it('should set error on failed load', async () => {
      const errorMessage = 'Failed to load providers'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await useProviderStore.getState().loadProviders()

      expect(useProviderStore.getState().providers).toEqual([])
      expect(useProviderStore.getState().isLoading).toBe(false)
      expect(useProviderStore.getState().error).toContain(errorMessage)
    })
  })

  describe('createProvider', () => {
    it('should create a new provider and add to store', async () => {
      const newProvider = createMockProvider('new-provider', 'New Provider')
      mockInvoke.mockResolvedValue(newProvider)

      const req: CreateProviderRequest = {
        name: 'New Provider',
        provider_type: 'openai',
        base_url: 'https://api.example.com',
      }
      const result = await useProviderStore.getState().createProvider(req)

      expect(mockInvoke).toHaveBeenCalledWith('create_provider', { req })
      expect(result).toEqual(newProvider)
      expect(useProviderStore.getState().providers).toContainEqual(newProvider)
    })

    it('should throw and set error on failure', async () => {
      const errorMessage = 'Failed to create provider'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      const req: CreateProviderRequest = {
        name: 'Test',
        provider_type: 'openai',
        base_url: 'https://test.com',
      }
      await expect(useProviderStore.getState().createProvider(req)).rejects.toThrow()

      expect(useProviderStore.getState().error).toContain(errorMessage)
    })
  })

  describe('updateProvider', () => {
    it('should update provider and update store', async () => {
      const provider = createMockProvider('provider-1', 'Old Name')
      useProviderStore.setState({ providers: [provider] })

      const updatedProvider = { ...provider, name: 'New Name' }
      mockInvoke.mockResolvedValue(updatedProvider)

      const req: CreateProviderRequest = {
        name: 'New Name',
        provider_type: 'openai',
        base_url: 'https://api.example.com',
      }
      const result = await useProviderStore.getState().updateProvider('provider-1', req)

      expect(mockInvoke).toHaveBeenCalledWith('update_provider', { id: 'provider-1', req })
      expect(result.name).toBe('New Name')
      expect(useProviderStore.getState().providers[0].name).toBe('New Name')
    })

    it('should throw and set error on failure', async () => {
      const provider = createMockProvider('provider-1', 'Test')
      useProviderStore.setState({ providers: [provider] })

      const errorMessage = 'Failed to update provider'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      const req: CreateProviderRequest = {
        name: 'New Name',
        provider_type: 'openai',
        base_url: 'https://test.com',
      }
      await expect(
        useProviderStore.getState().updateProvider('provider-1', req)
      ).rejects.toThrow()

      expect(useProviderStore.getState().error).toContain(errorMessage)
    })
  })

  describe('deleteProvider', () => {
    it('should delete provider and remove from store', async () => {
      const providers = [
        createMockProvider('provider-1', 'Provider 1'),
        createMockProvider('provider-2', 'Provider 2'),
      ]
      useProviderStore.setState({ providers })
      mockInvoke.mockResolvedValue(undefined)

      await useProviderStore.getState().deleteProvider('provider-1')

      expect(mockInvoke).toHaveBeenCalledWith('delete_provider', { id: 'provider-1' })
      expect(useProviderStore.getState().providers).toHaveLength(1)
      expect(useProviderStore.getState().providers[0].id).toBe('provider-2')
    })

    it('should throw and set error on failure', async () => {
      const provider = createMockProvider('provider-1', 'Test')
      useProviderStore.setState({ providers: [provider] })

      const errorMessage = 'Failed to delete provider'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await expect(useProviderStore.getState().deleteProvider('provider-1')).rejects.toThrow()

      expect(useProviderStore.getState().error).toContain(errorMessage)
      // Provider should still be in the store since delete failed
      expect(useProviderStore.getState().providers).toHaveLength(1)
    })
  })

  describe('getProviderById', () => {
    it('should return provider by id', () => {
      const providers = [
        createMockProvider('provider-1', 'OpenAI'),
        createMockProvider('provider-2', 'Anthropic'),
      ]
      useProviderStore.setState({ providers })

      const provider = useProviderStore.getState().getProviderById('provider-2')

      expect(provider).toEqual(providers[1])
    })

    it('should return undefined for non-existent id', () => {
      const provider = createMockProvider('provider-1', 'OpenAI')
      useProviderStore.setState({ providers: [provider] })

      const result = useProviderStore.getState().getProviderById('non-existent')

      expect(result).toBeUndefined()
    })
  })
})

