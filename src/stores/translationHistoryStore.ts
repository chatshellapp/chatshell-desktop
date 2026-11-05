import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { CreateTranslationHistoryRequest, TranslationHistoryEntry } from '@/types'
import { logger } from '@/lib/logger'
import { useSettingsStore } from './settingsStore'

/** Setting key for the "Save translation history" toggle (on unless set to 'false'). */
export const TRANSLATION_HISTORY_ENABLED_KEY = 'translation_history_enabled'
/** Mirrors the backend cap so the in-memory list never outgrows the table. */
export const TRANSLATION_HISTORY_CAP = 200

interface TranslationHistoryState {
  /** Newest-first entries, mirrored from the device-local table. */
  entries: TranslationHistoryEntry[]
  enabled: boolean
  isLoaded: boolean
  loadPromise: Promise<void> | null
}

interface TranslationHistoryActions {
  /** Idempotent load of entries and the enabled setting; retried after failure. */
  ensureLoaded: () => Promise<void>
  /** Record a completed translation unless history is turned off. */
  record: (req: CreateTranslationHistoryRequest) => Promise<void>
  remove: (id: string) => Promise<void>
  clearAll: () => Promise<void>
  setEnabled: (enabled: boolean) => void
}

type TranslationHistoryStore = TranslationHistoryState & TranslationHistoryActions

export const useTranslationHistoryStore = create<TranslationHistoryStore>()(
  immer((set, get) => ({
    entries: [],
    enabled: true,
    isLoaded: false,
    loadPromise: null,

    ensureLoaded: () => {
      const { isLoaded, loadPromise } = get()
      if (isLoaded) return Promise.resolve()
      if (loadPromise) return loadPromise

      const promise = (async () => {
        try {
          const [entries, enabledSetting] = await Promise.all([
            invoke<TranslationHistoryEntry[]>('list_translation_history'),
            useSettingsStore.getState().getSetting(TRANSLATION_HISTORY_ENABLED_KEY),
          ])
          set((draft) => {
            draft.entries = entries ?? []
            draft.enabled = enabledSetting !== 'false'
            draft.isLoaded = true
          })
        } catch (error) {
          logger.error('[translationHistoryStore] Failed to load history:', error)
        } finally {
          set((draft) => {
            draft.loadPromise = null
          })
        }
      })()
      set((draft) => {
        draft.loadPromise = promise
      })
      return promise
    },

    record: async (req) => {
      await get().ensureLoaded()
      if (!get().enabled) return
      try {
        const entry = await invoke<TranslationHistoryEntry | null>(
          'add_translation_history_entry',
          { req }
        )
        if (!entry) return
        set((draft) => {
          draft.entries = [entry, ...draft.entries.filter((e) => e.id !== entry.id)].slice(
            0,
            TRANSLATION_HISTORY_CAP
          )
        })
      } catch (error) {
        // Best-effort feature: a failed write must not affect the translation.
        logger.error('[translationHistoryStore] Failed to record entry:', error)
      }
    },

    remove: async (id) => {
      const previous = get().entries
      set((draft) => {
        draft.entries = draft.entries.filter((e) => e.id !== id)
      })
      try {
        await invoke('delete_translation_history_entry', { id })
      } catch (error) {
        logger.error('[translationHistoryStore] Failed to delete entry:', error)
        set((draft) => {
          draft.entries = previous
        })
        throw error
      }
    },

    clearAll: async () => {
      const previous = get().entries
      set((draft) => {
        draft.entries = []
      })
      try {
        await invoke('clear_translation_history')
      } catch (error) {
        logger.error('[translationHistoryStore] Failed to clear history:', error)
        set((draft) => {
          draft.entries = previous
        })
        throw error
      }
    },

    setEnabled: (enabled) => {
      set((draft) => {
        draft.enabled = enabled
      })
      useSettingsStore
        .getState()
        .saveSetting(TRANSLATION_HISTORY_ENABLED_KEY, String(enabled))
        .catch((error) =>
          logger.error('[translationHistoryStore] Failed to save enabled setting:', error)
        )
    },
  }))
)

/** Case-insensitive match on source or translated text; locale-aware folding. */
export function filterTranslationHistory(
  entries: TranslationHistoryEntry[],
  query: string
): TranslationHistoryEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return entries
  return entries.filter(
    (e) =>
      e.source_text.toLocaleLowerCase().includes(needle) ||
      e.translated_text.toLocaleLowerCase().includes(needle)
  )
}
