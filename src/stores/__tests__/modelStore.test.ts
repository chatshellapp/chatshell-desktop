import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useModelStore } from '../modelStore'
import type { Model, Provider } from '@/types'

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

const createMockModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'model-1',
  name: 'GPT-4o',
  provider_id: 'provider-1',
  model_id: 'gpt-4o',
  is_starred: false,
  is_deleted: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const createMockProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'provider-1',
  name: 'OpenAI',
  provider_type: 'openai',
  is_enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('useModelStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelStore.setState({
      models: [],
      providers: [],
      isLoading: false,
      error: null,
    })
  })

  describe('loadModels', () => {
    it('stores models returned by list_all_models and stops loading', async () => {
      const models = [createMockModel(), createMockModel({ id: 'model-2' })]
      mockInvoke.mockResolvedValueOnce(models)

      await useModelStore.getState().loadModels()

      expect(mockInvoke).toHaveBeenCalledWith('list_all_models')
      const state = useModelStore.getState()
      expect(state.models).toEqual(models)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('replaces stale models so the list stays in sync with the backend', async () => {
      useModelStore.setState({
        models: [createMockModel({ id: 'stale-model' })],
      })
      mockInvoke.mockResolvedValueOnce([
        createMockModel({ id: 'fresh-model-1' }),
        createMockModel({ id: 'fresh-model-2' }),
      ])

      await useModelStore.getState().loadModels()

      expect(useModelStore.getState().models.map((m) => m.id)).toEqual([
        'fresh-model-1',
        'fresh-model-2',
      ])
    })

    it('marks the store as loading while the request is in flight', async () => {
      let resolveFetch: ((models: Model[]) => void) | undefined
      mockInvoke.mockImplementationOnce(
        () =>
          new Promise<Model[]>((resolve) => {
            resolveFetch = resolve
          })
      )

      const pending = useModelStore.getState().loadModels()
      expect(useModelStore.getState().isLoading).toBe(true)

      resolveFetch?.([createMockModel()])
      await pending

      expect(useModelStore.getState().isLoading).toBe(false)
    })

    it('stores the error and stops loading when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('network down'))

      await useModelStore.getState().loadModels()

      const state = useModelStore.getState()
      expect(state.error).toBe('Error: network down')
      expect(state.isLoading).toBe(false)
      expect(state.models).toEqual([])
    })

    it('clears a previous error on the next successful load', async () => {
      useModelStore.setState({ error: 'old failure' })
      mockInvoke.mockResolvedValueOnce([createMockModel()])

      await useModelStore.getState().loadModels()

      expect(useModelStore.getState().error).toBeNull()
    })
  })

  describe('loadProviders', () => {
    it('stores providers returned by list_providers and stops loading', async () => {
      const providers = [
        createMockProvider(),
        createMockProvider({ id: 'provider-2', name: 'Anthropic' }),
      ]
      mockInvoke.mockResolvedValueOnce(providers)

      await useModelStore.getState().loadProviders()

      expect(mockInvoke).toHaveBeenCalledWith('list_providers')
      const state = useModelStore.getState()
      expect(state.providers).toEqual(providers)
      expect(state.isLoading).toBe(false)
      expect(state.models).toEqual([])
    })

    it('stores the error and stops loading when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce('db unavailable')

      await useModelStore.getState().loadProviders()

      const state = useModelStore.getState()
      expect(state.error).toBe('db unavailable')
      expect(state.isLoading).toBe(false)
      expect(state.providers).toEqual([])
    })
  })

  describe('loadAll', () => {
    it('loads models and providers in parallel and stores both', async () => {
      const models = [createMockModel()]
      const providers = [createMockProvider()]
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'list_all_models') return models
        if (cmd === 'list_providers') return providers
        throw new Error(`unexpected command: ${cmd}`)
      })

      await useModelStore.getState().loadAll()

      expect(mockInvoke).toHaveBeenCalledWith('list_all_models')
      expect(mockInvoke).toHaveBeenCalledWith('list_providers')
      const state = useModelStore.getState()
      expect(state.models).toEqual(models)
      expect(state.providers).toEqual(providers)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('stores the error when either request fails', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'list_all_models') return [createMockModel()]
        throw new Error('providers unavailable')
      })

      await useModelStore.getState().loadAll()

      const state = useModelStore.getState()
      expect(state.error).toBe('Error: providers unavailable')
      expect(state.isLoading).toBe(false)
      expect(state.models).toEqual([])
      expect(state.providers).toEqual([])
    })
  })

  describe('updateModel', () => {
    it('replaces the matching model with the updated one and returns it', async () => {
      useModelStore.setState({
        models: [
          createMockModel({ id: 'model-a', name: 'Old name' }),
          createMockModel({ id: 'model-b' }),
        ],
      })
      const updated = createMockModel({ id: 'model-a', name: 'New name' })
      mockInvoke.mockResolvedValueOnce(updated)

      const req = { name: 'New name', provider_id: 'provider-1', model_id: 'gpt-4o' }
      const result = await useModelStore.getState().updateModel('model-a', req)

      expect(mockInvoke).toHaveBeenCalledWith('update_model', {
        id: 'model-a',
        req,
      })
      expect(result).toEqual(updated)
      const state = useModelStore.getState()
      expect(state.models[0]).toEqual(updated)
      expect(state.models[0].name).toBe('New name')
      // Sibling model is untouched
      expect(state.models[1].name).toBe('GPT-4o')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('leaves the list unchanged when the id is unknown', async () => {
      const existing = [createMockModel({ id: 'model-a' })]
      useModelStore.setState({ models: existing })
      const orphan = createMockModel({ id: 'ghost' })
      mockInvoke.mockResolvedValueOnce(orphan)

      const result = await useModelStore.getState().updateModel('ghost', {
        name: 'Ghost',
        provider_id: 'provider-1',
        model_id: 'ghost-1',
      })

      expect(result).toEqual(orphan)
      expect(useModelStore.getState().models).toEqual(existing)
      expect(useModelStore.getState().isLoading).toBe(false)
    })

    it('propagates the error, stores it and stops loading', async () => {
      useModelStore.setState({
        models: [createMockModel({ id: 'model-a', name: 'Old name' })],
      })
      mockInvoke.mockRejectedValueOnce(new Error('validation failed'))

      await expect(
        useModelStore.getState().updateModel('model-a', {
          name: 'New name',
          provider_id: 'provider-1',
          model_id: 'gpt-4o',
        })
      ).rejects.toThrow('validation failed')

      const state = useModelStore.getState()
      expect(state.error).toBe('Error: validation failed')
      expect(state.isLoading).toBe(false)
      // Optimistic-free: list keeps the old model after failure
      expect(state.models[0].name).toBe('Old name')
    })
  })

  describe('deleteModel', () => {
    it('soft-deletes the matching model by flagging is_deleted', async () => {
      useModelStore.setState({
        models: [createMockModel({ id: 'model-a' }), createMockModel({ id: 'model-b' })],
      })
      mockInvoke.mockResolvedValueOnce(null)

      await useModelStore.getState().deleteModel('model-a')

      expect(mockInvoke).toHaveBeenCalledWith('delete_model', { id: 'model-a' })
      const state = useModelStore.getState()
      // Soft delete keeps the row in the list but flags it
      expect(state.models.map((m) => m.id)).toEqual(['model-a', 'model-b'])
      expect(state.models[0].is_deleted).toBe(true)
      expect(state.models[1].is_deleted).toBe(false)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('leaves the list unchanged when the id is unknown', async () => {
      const existing = [createMockModel({ id: 'model-a' })]
      useModelStore.setState({ models: existing })
      mockInvoke.mockResolvedValueOnce(null)

      await useModelStore.getState().deleteModel('ghost')

      expect(useModelStore.getState().models).toEqual(existing)
      expect(useModelStore.getState().isLoading).toBe(false)
    })

    it('propagates the error, stores it and keeps the model undeleted', async () => {
      useModelStore.setState({ models: [createMockModel({ id: 'model-a' })] })
      mockInvoke.mockRejectedValueOnce(new Error('delete denied'))

      await expect(useModelStore.getState().deleteModel('model-a')).rejects.toThrow('delete denied')

      const state = useModelStore.getState()
      expect(state.error).toBe('Error: delete denied')
      expect(state.isLoading).toBe(false)
      expect(state.models[0].is_deleted).toBe(false)
    })
  })

  describe('getModelById', () => {
    it('returns the model with the matching id', () => {
      const target = createMockModel({ id: 'model-b' })
      useModelStore.setState({
        models: [createMockModel({ id: 'model-a' }), target],
      })

      expect(useModelStore.getState().getModelById('model-b')).toEqual(target)
    })

    it('returns undefined for an unknown id', () => {
      useModelStore.setState({ models: [createMockModel({ id: 'model-a' })] })

      expect(useModelStore.getState().getModelById('nope')).toBeUndefined()
    })
  })

  describe('getProviderById', () => {
    it('returns the provider with the matching id', () => {
      const target = createMockProvider({ id: 'provider-2' })
      useModelStore.setState({
        providers: [createMockProvider(), target],
      })

      expect(useModelStore.getState().getProviderById('provider-2')).toEqual(target)
    })

    it('returns undefined for an unknown id', () => {
      expect(useModelStore.getState().getProviderById('nope')).toBeUndefined()
    })
  })
})
