import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import {
  useVisionFallbackStatus,
  fetchVisionFallbackStatus,
  invalidateVisionFallbackStatus,
} from '../useVisionFallbackStatus'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const UNAVAILABLE = { available: false, provider_type: null, model_id: null }

describe('useVisionFallbackStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockResolvedValue({
      available: true,
      provider_type: 'openai',
      model_id: 'gpt-4o',
    })
    invalidateVisionFallbackStatus()
  })

  describe('fetchVisionFallbackStatus', () => {
    it('resolves the backend status and caches it', async () => {
      const first = await fetchVisionFallbackStatus()
      const second = await fetchVisionFallbackStatus()

      expect(first).toEqual({ available: true, provider_type: 'openai', model_id: 'gpt-4o' })
      expect(second).toBe(first)
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_vision_fallback_status')
    })

    it('reports no fallback when the probe fails and retries on the next call', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('probe failed'))

      const failed = await fetchVisionFallbackStatus()

      expect(failed).toEqual(UNAVAILABLE)
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to get vision fallback status:',
        expect.any(Error)
      )

      vi.mocked(invoke).mockResolvedValue({
        available: true,
        provider_type: 'anthropic',
        model_id: 'claude-3',
      })
      const retried = await fetchVisionFallbackStatus()

      expect(retried.available).toBe(true)
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
    })

    it('refetches after invalidation', async () => {
      await fetchVisionFallbackStatus()
      invalidateVisionFallbackStatus()
      await fetchVisionFallbackStatus()

      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
    })
  })

  describe('useVisionFallbackStatus hook', () => {
    it('starts unavailable before the probe resolves', async () => {
      const deferred = Promise.withResolvers<{ available: boolean }>()
      vi.mocked(invoke).mockImplementation(() => deferred.promise as never)

      const { result } = renderHook(() => useVisionFallbackStatus())

      expect(result.current).toEqual(UNAVAILABLE)

      await act(async () => {
        deferred.resolve(UNAVAILABLE)
        await deferred.promise
      })
    })

    it('resolves the fallback status for the mounted hook', async () => {
      const { result } = renderHook(() => useVisionFallbackStatus())

      await waitFor(() => expect(result.current.available).toBe(true))
      expect(result.current.provider_type).toBe('openai')
      expect(result.current.model_id).toBe('gpt-4o')
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
    })

    it('refetches when the status is invalidated while mounted', async () => {
      const { result } = renderHook(() => useVisionFallbackStatus())
      await waitFor(() => expect(result.current.available).toBe(true))

      vi.mocked(invoke).mockResolvedValue(UNAVAILABLE)
      act(() => {
        invalidateVisionFallbackStatus()
      })

      await waitFor(() => expect(result.current.available).toBe(false))
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
    })

    it('stops listening after unmount', async () => {
      const { result, unmount } = renderHook(() => useVisionFallbackStatus())
      await waitFor(() => expect(result.current.available).toBe(true))
      unmount()

      vi.mocked(invoke).mockResolvedValue(UNAVAILABLE)
      act(() => {
        invalidateVisionFallbackStatus()
      })

      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
    })
  })
})
