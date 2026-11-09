import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  displayedPermissionMode,
  permissionModeHintKey,
  useAutoReviewStatus,
  type AutoReviewStatus,
} from '../permission-mode'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const judged: AutoReviewStatus = { resolution: 'judged', reason: null, judge: 'openai/gpt' }
const ask: AutoReviewStatus = {
  resolution: 'ask',
  reason: 'The model did not return a structured verdict.',
  judge: 'ollama/tiny',
}

describe('displayedPermissionMode', () => {
  it('shows auto unless it resolves to ask, on every platform', () => {
    expect(displayedPermissionMode('auto', judged)).toBe('auto')
    expect(displayedPermissionMode('auto', ask)).toBe('ask')
    // Unknown yet: the requested mode.
    expect(displayedPermissionMode('auto', null)).toBe('auto')
    expect(displayedPermissionMode('yolo', ask)).toBe('yolo')
  })
})

describe('permissionModeHintKey', () => {
  it('describes ask by platform and leaves the other modes alone', () => {
    expect(permissionModeHintKey('ask', true)).toBe('permission.mode.askSandboxHint')
    expect(permissionModeHintKey('ask', false)).toBe('permission.mode.askHint')
    expect(permissionModeHintKey('auto', true)).toBe('permission.mode.autoHint')
    expect(permissionModeHintKey('yolo', false)).toBe('permission.mode.yoloHint')
  })
})

describe('useAutoReviewStatus', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('asks the backend per model and re-checks on a model change', async () => {
    invoke.mockResolvedValue(judged)
    const { result, rerender } = renderHook(({ model }) => useAutoReviewStatus(model), {
      initialProps: { model: 'model-a' as string | null },
    })
    await waitFor(() => expect(result.current).toEqual(judged))
    expect(invoke).toHaveBeenLastCalledWith('get_auto_review_status', {
      modelDbId: 'model-a',
      recheck: false,
    })
    invoke.mockResolvedValue(ask)
    rerender({ model: 'model-b' })
    await waitFor(() => expect(result.current).toEqual(ask))
    // Back to a model already seen: a model change re-probes it.
    invoke.mockResolvedValue(judged)
    rerender({ model: 'model-a' })
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith('get_auto_review_status', {
        modelDbId: 'model-a',
        recheck: true,
      })
    )
    rerender({ model: null })
    expect(result.current).toBeNull()
  })

  it('treats a failed status call as unknown', async () => {
    invoke.mockImplementation(() => Promise.reject(new Error('offline')))
    const { result } = renderHook(() => useAutoReviewStatus('model-z'))
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(result.current).toBeNull()
  })
})
