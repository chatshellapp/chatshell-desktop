import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useVendorsList } from '../useVendorsList'
import { useModelStore } from '@/stores/modelStore'
import type { Model, Provider } from '@/types'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

const providerA: Provider = {
  id: 'provider-a',
  name: 'OpenAI',
  provider_type: 'openai',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

const providerB: Provider = {
  id: 'provider-b',
  name: 'Anthropic',
  provider_type: 'anthropic',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

const providerEmpty: Provider = {
  id: 'provider-empty',
  name: 'Empty',
  provider_type: 'ollama',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

const makeModel = (overrides: Partial<Model> & { id: string }): Model => ({
  provider_id: 'provider-a',
  name: `Model ${overrides.id}`,
  model_id: overrides.id,
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

describe('useVendorsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelStore.setState({
      models: [],
      providers: [],
      isLoading: false,
      error: null,
    })
  })

  it('returns no vendors when there are no providers', () => {
    useModelStore.setState({ models: [makeModel({ id: 'gpt-4o' })] })

    const { result } = renderHook(() => useVendorsList())

    expect(result.current).toEqual([])
  })

  it('groups each provider with only its live models', () => {
    useModelStore.setState({
      providers: [providerA, providerB],
      models: [
        makeModel({ id: 'gpt-4o', is_starred: true }),
        makeModel({ id: 'claude-3', provider_id: 'provider-b' }),
      ],
    })

    const { result } = renderHook(() => useVendorsList())

    expect(result.current.map((v) => v.id)).toEqual(['provider-a', 'provider-b'])
    expect(result.current[0].models).toHaveLength(1)
    expect(result.current[0].models[0]).toEqual({
      id: 'gpt-4o',
      name: 'Model gpt-4o',
      modelId: 'gpt-4o',
      logo: expect.any(String),
      isStarred: true,
    })
    expect(result.current[1].models[0].modelId).toBe('claude-3')
    expect(result.current[1].models[0].isStarred).toBe(false)
  })

  it('drops providers that have no selectable models', () => {
    useModelStore.setState({
      providers: [providerA, providerEmpty],
      models: [makeModel({ id: 'gpt-4o' }), makeModel({ id: 'deleted-model', is_deleted: true })],
    })

    const { result } = renderHook(() => useVendorsList())

    expect(result.current.map((v) => v.id)).toEqual(['provider-a'])
    expect(result.current[0].models.map((m) => m.id)).toEqual(['gpt-4o'])
  })
})
