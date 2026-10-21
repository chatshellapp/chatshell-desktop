import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import type { Update } from '@tauri-apps/plugin-updater'
import { useSettingsStore } from '@/stores/settingsStore'
import { logger } from '@/lib/logger'

// Preference keys persisted through the settings table.
const AUTO_CHECK_KEY = 'updater.auto_check'
const SKIPPED_VERSION_KEY = 'updater.skipped_version'

export type UpdaterStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing'

interface UpdaterStore {
  status: UpdaterStatus
  // Non-null when a newer version has been found (but not skipped).
  update: Update | null
  currentVersion: string | null
  downloadedBytes: number
  totalBytes: number
  error: string | null
  autoCheckEnabled: boolean
  skippedVersion: string | null

  loadPreferences: () => Promise<void>
  runStartupCheck: () => Promise<void>
  checkForUpdates: (options: { silent: boolean }) => Promise<Update | null>
  downloadUpdate: () => Promise<void>
  installAndRestart: () => Promise<void>
  setAutoCheck: (enabled: boolean) => Promise<void>
  skipCurrentVersion: () => Promise<void>
}

/**
 * Compares two dotted version strings (e.g. "0.9.0" vs "0.8.3").
 * Returns a positive number when `a` is greater, negative when smaller, 0 on equality.
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const bParts = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < length; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export const useUpdaterStore = create<UpdaterStore>()(
  immer((set, get) => ({
    status: 'idle',
    update: null,
    currentVersion: null,
    downloadedBytes: 0,
    totalBytes: 0,
    error: null,
    autoCheckEnabled: true,
    skippedVersion: null,

    loadPreferences: async () => {
      const { getSetting } = useSettingsStore.getState()
      try {
        const [autoCheck, skipped, version] = await Promise.all([
          getSetting(AUTO_CHECK_KEY),
          getSetting(SKIPPED_VERSION_KEY),
          getVersion(),
        ])
        set((draft) => {
          // Absent setting means default-on (documented in Settings > About).
          draft.autoCheckEnabled = autoCheck !== 'false'
          draft.skippedVersion = skipped
          draft.currentVersion = version
        })
      } catch (error) {
        logger.error('Failed to load updater preferences:', error)
      }
    },

    runStartupCheck: async () => {
      await get().loadPreferences()
      if (!get().autoCheckEnabled) return
      await get().checkForUpdates({ silent: true })
    },

    checkForUpdates: async ({ silent }) => {
      if (get().status === 'checking' || get().status === 'downloading') return null
      set((draft) => {
        draft.status = 'checking'
        draft.error = null
      })
      try {
        const result = await check()
        if (result === null) {
          set((draft) => {
            draft.status = 'idle'
            draft.update = null
          })
          return null
        }
        // Honor "skip this version" until a strictly greater version ships.
        const skipped = get().skippedVersion
        if (skipped && compareVersions(result.version, skipped) <= 0) {
          set((draft) => {
            draft.status = 'idle'
          })
          result.close()
          return null
        }
        set((draft) => {
          draft.status = 'idle'
          draft.update = result
        })
        return result
      } catch (error) {
        set((draft) => {
          draft.status = 'idle'
          // Background checks must stay silent: only manual checks surface this.
          draft.error = silent ? null : String(error)
        })
        if (!silent) logger.error('Update check failed:', error)
        else logger.warn('Background update check failed:', error)
        return null
      }
    },

    downloadUpdate: async () => {
      const update = get().update
      if (!update || get().status === 'downloading') return
      set((draft) => {
        draft.status = 'downloading'
        draft.error = null
        draft.downloadedBytes = 0
        draft.totalBytes = 0
      })
      try {
        let total = 0
        let received = 0
        await update.download((event) => {
          switch (event.event) {
            case 'Started':
              total = event.data.contentLength ?? 0
              break
            case 'Progress':
              received += event.data.chunkLength
              break
            case 'Finished':
              break
          }
          set((draft) => {
            draft.downloadedBytes = received
            draft.totalBytes = total
          })
        })
        set((draft) => {
          draft.status = 'ready'
        })
      } catch (error) {
        set((draft) => {
          draft.status = 'idle'
          draft.error = String(error)
        })
        logger.error('Update download failed:', error)
      }
    },

    installAndRestart: async () => {
      const update = get().update
      if (!update || get().status !== 'ready') return
      set((draft) => {
        draft.status = 'installing'
        draft.error = null
      })
      try {
        await update.install()
        await relaunch()
      } catch (error) {
        set((draft) => {
          draft.status = 'ready'
          draft.error = String(error)
        })
        logger.error('Update install failed:', error)
      }
    },

    setAutoCheck: async (enabled: boolean) => {
      set((draft) => {
        draft.autoCheckEnabled = enabled
      })
      const { saveSetting } = useSettingsStore.getState()
      try {
        await saveSetting(AUTO_CHECK_KEY, enabled ? 'true' : 'false')
      } catch (error) {
        logger.error('Failed to save auto-check preference:', error)
      }
    },

    skipCurrentVersion: async () => {
      const update = get().update
      if (!update) return
      set((draft) => {
        draft.skippedVersion = update.version
        draft.update = null
      })
      const { saveSetting } = useSettingsStore.getState()
      try {
        await saveSetting(SKIPPED_VERSION_KEY, update.version)
      } catch (error) {
        logger.error('Failed to save skipped version:', error)
      }
    },
  }))
)
