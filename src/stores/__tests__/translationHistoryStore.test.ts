import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TranslationHistoryEntry } from '@/types'

const { invokeMock, getSetting, saveSetting } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getSetting: vi.fn(),
  saveSetting: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../settingsStore', () => ({
  useSettingsStore: { getState: () => ({ getSetting, saveSetting }) },
}))

import {
  TRANSLATION_HISTORY_CAP,
  TRANSLATION_HISTORY_ENABLED_KEY,
  filterTranslationHistory,
  useTranslationHistoryStore,
} from '../translationHistoryStore'

const entry = (id: string, overrides: Partial<TranslationHistoryEntry> = {}) => ({
  id,
  source_text: `source ${id}`,
  translated_text: `translated ${id}`,
  source_language: 'en',
  target_language: 'fr',
  model_id: 'model-1',
  created_at: '2026-11-02T00:00:00Z',
  ...overrides,
})

const request = {
  source_text: 'hello',
  translated_text: 'bonjour',
  source_language: 'en',
  target_language: 'fr',
  model_id: 'model-1',
}

const mockBackend = (entries: TranslationHistoryEntry[] = [], enabled: string | null = null) => {
  getSetting.mockResolvedValue(enabled)
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_translation_history') return entries
    return undefined
  })
}

describe('translationHistoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockReset()
    saveSetting.mockResolvedValue(undefined)
    useTranslationHistoryStore.setState({
      entries: [],
      enabled: true,
      isLoaded: false,
      loadPromise: null,
    })
  })

  it('loads entries and the enabled setting once, sharing concurrent loads', async () => {
    mockBackend([entry('a')], 'false')

    const store = useTranslationHistoryStore.getState()
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()])
    await store.ensureLoaded()

    const listCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'list_translation_history')
    expect(listCalls).toHaveLength(1)
    expect(getSetting).toHaveBeenCalledWith(TRANSLATION_HISTORY_ENABLED_KEY)
    expect(useTranslationHistoryStore.getState().entries.map((e) => e.id)).toEqual(['a'])
    expect(useTranslationHistoryStore.getState().enabled).toBe(false)
  })

  it('defaults to enabled when the setting is missing', async () => {
    mockBackend([], null)
    await useTranslationHistoryStore.getState().ensureLoaded()
    expect(useTranslationHistoryStore.getState().enabled).toBe(true)
  })

  it('retries loading after a failure', async () => {
    getSetting.mockResolvedValue(null)
    invokeMock.mockRejectedValueOnce(new Error('db locked')).mockResolvedValue([entry('a')])

    await useTranslationHistoryStore.getState().ensureLoaded()
    expect(useTranslationHistoryStore.getState().isLoaded).toBe(false)
    await useTranslationHistoryStore.getState().ensureLoaded()

    expect(useTranslationHistoryStore.getState().entries).toHaveLength(1)
  })

  it('records an entry and moves an updated entry to the front', async () => {
    mockBackend([entry('a'), entry('b')])
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_translation_history') return [entry('a'), entry('b')]
      if (cmd === 'add_translation_history_entry') return entry('b', { translated_text: 'new' })
      return undefined
    })

    await useTranslationHistoryStore.getState().record(request)

    expect(invokeMock).toHaveBeenCalledWith('add_translation_history_entry', { req: request })
    const { entries } = useTranslationHistoryStore.getState()
    expect(entries.map((e) => e.id)).toEqual(['b', 'a'])
    expect(entries[0].translated_text).toBe('new')
  })

  it('keeps the in-memory list within the cap', async () => {
    const existing = Array.from({ length: TRANSLATION_HISTORY_CAP }, (_, i) => entry(`e${i}`))
    getSetting.mockResolvedValue(null)
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_translation_history') return existing
      if (cmd === 'add_translation_history_entry') return entry('new')
      return undefined
    })

    await useTranslationHistoryStore.getState().record(request)

    const { entries } = useTranslationHistoryStore.getState()
    expect(entries).toHaveLength(TRANSLATION_HISTORY_CAP)
    expect(entries[0].id).toBe('new')
  })

  it('does not record when history is turned off', async () => {
    mockBackend([], 'false')

    await useTranslationHistoryStore.getState().record(request)

    expect(invokeMock).not.toHaveBeenCalledWith('add_translation_history_entry', expect.anything())
  })

  it('swallows record failures', async () => {
    getSetting.mockResolvedValue(null)
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_translation_history') return []
      throw new Error('disk full')
    })

    await expect(useTranslationHistoryStore.getState().record(request)).resolves.toBeUndefined()
    expect(useTranslationHistoryStore.getState().entries).toEqual([])
  })

  it('removes an entry and restores it when deletion fails', async () => {
    useTranslationHistoryStore.setState({ entries: [entry('a'), entry('b')], isLoaded: true })
    invokeMock.mockResolvedValueOnce(undefined)

    await useTranslationHistoryStore.getState().remove('a')
    expect(invokeMock).toHaveBeenCalledWith('delete_translation_history_entry', { id: 'a' })
    expect(useTranslationHistoryStore.getState().entries.map((e) => e.id)).toEqual(['b'])

    invokeMock.mockRejectedValueOnce(new Error('boom'))
    await expect(useTranslationHistoryStore.getState().remove('b')).rejects.toThrow('boom')
    expect(useTranslationHistoryStore.getState().entries.map((e) => e.id)).toEqual(['b'])
  })

  it('clears all entries and restores them when clearing fails', async () => {
    useTranslationHistoryStore.setState({ entries: [entry('a')], isLoaded: true })

    invokeMock.mockRejectedValueOnce(new Error('boom'))
    await expect(useTranslationHistoryStore.getState().clearAll()).rejects.toThrow('boom')
    expect(useTranslationHistoryStore.getState().entries).toHaveLength(1)

    invokeMock.mockResolvedValueOnce(undefined)
    await useTranslationHistoryStore.getState().clearAll()
    expect(invokeMock).toHaveBeenCalledWith('clear_translation_history')
    expect(useTranslationHistoryStore.getState().entries).toEqual([])
  })

  it('persists the enabled toggle', () => {
    useTranslationHistoryStore.getState().setEnabled(false)

    expect(useTranslationHistoryStore.getState().enabled).toBe(false)
    expect(saveSetting).toHaveBeenCalledWith(TRANSLATION_HISTORY_ENABLED_KEY, 'false')
  })
})

describe('filterTranslationHistory', () => {
  const entries = [
    entry('a', { source_text: 'Hello world', translated_text: 'Bonjour le monde' }),
    entry('b', { source_text: 'ÉCOLE', translated_text: 'school' }),
  ]

  it('returns everything for a blank query', () => {
    expect(filterTranslationHistory(entries, '  ')).toBe(entries)
  })

  it('matches source or translated text case-insensitively, including non-ASCII', () => {
    expect(filterTranslationHistory(entries, 'HELLO').map((e) => e.id)).toEqual(['a'])
    expect(filterTranslationHistory(entries, 'monde').map((e) => e.id)).toEqual(['a'])
    expect(filterTranslationHistory(entries, 'école').map((e) => e.id)).toEqual(['b'])
  })
})
