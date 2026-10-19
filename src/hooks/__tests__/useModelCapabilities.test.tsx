import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import {
  useModelCapabilities,
  fetchModelCapabilities,
  invalidateCapabilitiesCache,
} from '../useModelCapabilities'
import type { Model, ModelCapabilities, Provider } from '@/types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

const provider: Provider = {
  id: 'provider-1',
  name: 'OpenAI',
  provider_type: 'openai',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

const model: Model = {
  id: 'model-1',
  provider_id: 'provider-1',
  name: 'GPT-4o',
  model_id: 'gpt-4o',
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
}

const caps: ModelCapabilities = {
  supports_tool_use: true,
  supports_vision: false,
  supports_image_generation: false,
  supports_reasoning: true,
  max_context_length: 128000,
  max_output_length: 16384,
}

const UNKNOWN_CAPS: ModelCapabilities = {
  supports_tool_use: null,
  supports_vision: null,
  supports_image_generation: null,
  supports_reasoning: null,
  max_context_length: null,
  max_output_length: null,
}

describe('useModelCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockResolvedValue(caps)
    invalidateCapabilitiesCache()
  })

  describe('fetchModelCapabilities', () => {
    it('fetches capabilities from the backend and caches them', async () => {
      const first = await fetchModelCapabilities('openai', 'gpt-4o')
      const second = await fetchModelCapabilities('openai', 'gpt-4o')

      expect(first).toEqual(caps)
      expect(second).toBe(first)
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_model_capabilities', {
        providerType: 'openai',
        modelId: 'gpt-4o',
      })
    })

    it('caches per provider and model pair', async () => {
      await fetchModelCapabilities('openai', 'gpt-4o')
      await fetchModelCapabilities('anthropic', 'gpt-4o')

      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
    })

    it('falls back to unknown capabilities on failure', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('probe failed'))

      const result = await fetchModelCapabilities('openai', 'gpt-4o')

      expect(result).toEqual(UNKNOWN_CAPS)
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to get model capabilities:',
        expect.any(Error)
      )
    })

    it('refetches after the cache is invalidated', async () => {
      await fetchModelCapabilities('openai', 'gpt-4o')
      invalidateCapabilitiesCache()
      await fetchModelCapabilities('openai', 'gpt-4o')

      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
    })
  })

  describe('useModelCapabilities hook', () => {
    it('returns unknown capabilities without a model or provider', () => {
      vi.mocked(invoke).mockResolvedValue(caps)
      const withoutModel = renderHook(() => useModelCapabilities(null, provider))
      const withoutProvider = renderHook(() => useModelCapabilities(model, null))

      expect(withoutModel.result.current).toEqual(UNKNOWN_CAPS)
      expect(withoutProvider.result.current).toEqual(UNKNOWN_CAPS)
      expect(vi.mocked(invoke)).not.toHaveBeenCalled()
    })

    it('resolves capabilities for a model and provider', async () => {
      const { result } = renderHook(() => useModelCapabilities(model, provider))

      await waitFor(() => expect(result.current).toEqual(caps))
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_model_capabilities', {
        providerType: 'openai',
        modelId: 'gpt-4o',
      })
    })

    it('serves a warm cache without hitting the backend again', async () => {
      await fetchModelCapabilities('openai', 'gpt-4o')

      const { result } = renderHook(() => useModelCapabilities(model, provider))

      await waitFor(() => expect(result.current).toBe(caps))
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
    })

    it('ignores a stale response after the model changes', async () => {
      const slow = Promise.withResolvers<ModelCapabilities>()
      const fast = Promise.withResolvers<ModelCapabilities>()
      vi.mocked(invoke).mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === 'get_model_capabilities' && args?.modelId === 'gpt-4o') return slow.promise
        return fast.promise
      }) as typeof invoke)

      const otherModel = { ...model, id: 'model-2', model_id: 'claude-3' }
      const { result, rerender } = renderHook(
        ({ modelArg }: { modelArg: Model } = { modelArg: model }) =>
          useModelCapabilities(modelArg, provider)
      )

      rerender({ modelArg: otherModel })
      const fastCaps = { ...caps, supports_vision: true }
      fast.resolve(fastCaps)
      await fast.promise

      await waitFor(() => expect(result.current).toEqual(fastCaps))

      slow.resolve(caps)
      await slow.promise
      expect(result.current).toEqual(fastCaps)
    })
  })
})
