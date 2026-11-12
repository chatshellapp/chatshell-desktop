import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { usePresetStore } from '../presetStore'
import type { ModelParameterPreset } from '@/types'

const mockInvoke = vi.mocked(invoke)

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'
const make = (id: string, overrides: Partial<ModelParameterPreset> = {}): ModelParameterPreset => ({
  id,
  name: id,
  is_system: false,
  is_default: false,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

describe('presetStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePresetStore.setState({ presets: [], isLoaded: false, isLoading: false, error: null })
  })

  it('loads once through ensureLoaded', async () => {
    mockInvoke.mockResolvedValue([make('a')])

    await usePresetStore.getState().ensureLoaded()
    await usePresetStore.getState().ensureLoaded()

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(usePresetStore.getState().presets.map((p) => p.id)).toEqual(['a'])
  })

  it('records load errors', async () => {
    mockInvoke.mockRejectedValue(new Error('db'))
    await usePresetStore.getState().loadPresets()
    expect(usePresetStore.getState().error).toContain('db')
    expect(usePresetStore.getState().isLoaded).toBe(false)
  })

  it('appends created presets and reloads when the new one is default', async () => {
    mockInvoke.mockResolvedValueOnce(make('b'))
    await usePresetStore.getState().createPreset({ name: 'b' })
    expect(usePresetStore.getState().presets.map((p) => p.id)).toEqual(['b'])

    mockInvoke
      .mockResolvedValueOnce(make('c', { is_default: true }))
      .mockResolvedValueOnce([make('b'), make('c', { is_default: true })])
    await usePresetStore.getState().createPreset({ name: 'c', is_default: true })
    expect(mockInvoke).toHaveBeenLastCalledWith('list_model_parameter_presets')
    expect(usePresetStore.getState().presets).toHaveLength(2)
  })

  it('replaces updated presets in place', async () => {
    usePresetStore.setState({ presets: [make('a'), make('b')] })
    mockInvoke.mockResolvedValueOnce(make('b', { name: 'renamed' }))

    await usePresetStore.getState().updatePreset('b', { name: 'renamed', temperature: null })

    expect(mockInvoke).toHaveBeenCalledWith('update_model_parameter_preset', {
      id: 'b',
      req: { name: 'renamed', temperature: null },
    })
    expect(usePresetStore.getState().presets[1].name).toBe('renamed')
  })

  it('reloads after moving the default', async () => {
    mockInvoke
      .mockResolvedValueOnce(make('a', { is_default: true }))
      .mockResolvedValueOnce([make('a', { is_default: true })])

    await usePresetStore.getState().setDefaultPreset('a')

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'set_default_model_parameter_preset', {
      id: 'a',
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'list_model_parameter_presets')
  })

  it('removes deleted presets and keeps them on failure', async () => {
    usePresetStore.setState({ presets: [make('a'), make('b')] })
    mockInvoke.mockResolvedValueOnce(undefined)
    await usePresetStore.getState().deletePreset('a')
    expect(usePresetStore.getState().presets.map((p) => p.id)).toEqual(['b'])

    mockInvoke.mockRejectedValueOnce(new Error('in use'))
    await expect(usePresetStore.getState().deletePreset('b')).rejects.toThrow('in use')
    expect(usePresetStore.getState().presets.map((p) => p.id)).toEqual(['b'])
  })
})
