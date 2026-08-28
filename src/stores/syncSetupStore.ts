import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { logger } from '@/lib/logger'

/** Field names mirror the Rust struct's serde serialization (snake_case,
 * matching the project's other Tauri bindings e.g. BlobFetchStatus). */
export interface SyncSetupStateInfo {
  enabled: boolean
  onboarded: boolean
  needs_onboarding: boolean
  needs_passphrase: boolean
  container_available: boolean
  /** A remote sync group exists — joining is unlock, never bootstrap. */
  group_exists: boolean
  engine_active: boolean
  /** Last failed pass (auto or manual), surfaced as the escape-hatch cue. */
  last_pass_error: string | null
}

/** Outcome of `sync_now` / `force_sync_publish`. */
export interface SyncNowResultInfo {
  enabled: boolean
  action: string
  rows_merged: number
  republished: boolean
}

interface SyncSetupStore {
  info: SyncSetupStateInfo | null
  /** Fired when the backend ladder reaches the passphrase rung. */
  lockedEvent: boolean
  load: () => Promise<void>
  refreshInfo: () => Promise<void>
  startOnboarding: () => Promise<string>
  completeOnboarding: (passphrase: string) => Promise<void>
  declineOnboarding: () => Promise<void>
  unlock: (passphrase: string) => Promise<void>
  enable: () => Promise<void>
  /** Silent ladder adoption for joining an existing group; rejects with
   * "Passphrase required" when only the passphrase rung is left. */
  tryJoin: () => Promise<void>
  disable: (deleteCloudData: boolean) => Promise<string>
  /** Manual escape hatch: full pass (pull + merge + publish) that also
   * re-runs the content-key ladder and rebuilds a wedged engine. */
  syncNow: () => Promise<SyncNowResultInfo>
  /** Manual escape hatch: unconditional version-bumped publish for
   * stranded-row rescue. */
  forcePublish: () => Promise<SyncNowResultInfo>
}

let unsubscribeLocked: (() => void) | null = null
let unsubscribeError: (() => void) | null = null
let listenersRegistered = false
let listenersReady: Promise<void> | null = null

export const useSyncSetupStore = create<SyncSetupStore>((set, get) => ({
  info: null,
  lockedEvent: false,

  load: async () => {
    // Register listeners exactly once; concurrent loads await the same
    // registration promise instead of racing duplicate listeners (audit
    // 2026-08-28, low). Unlisten handles are retained so a future store
    // teardown could release them (they were previously discarded).
    if (!listenersRegistered) {
      listenersRegistered = true
      listenersReady = (async () => {
        unsubscribeLocked = await listen('sync-locked', () => {
          set({ lockedEvent: true })
          const current = get().info
          if (current) set({ info: { ...current, needs_passphrase: true } })
        })
        unsubscribeError = await listen<string>('sync-error', (event) => {
          // Info may not be loaded yet (banner shown at launch): refresh
          // it so the latch is not silently dropped (audit 2026-08-28, low).
          const current = get().info
          if (current) set({ info: { ...current, last_pass_error: event.payload } })
          else void get().refreshInfo()
        })
      })()
    }
    await listenersReady
    try {
      const info = await invoke<SyncSetupStateInfo>('get_sync_setup_state')
      set({ info, lockedEvent: info.needs_passphrase })
    } catch (err) {
      logger.error('Failed to load sync setup state:', err)
    }
  },

  refreshInfo: async () => {
    try {
      const info = await invoke<SyncSetupStateInfo>('get_sync_setup_state')
      set({ info })
    } catch (err) {
      logger.error('Failed to refresh sync setup state:', err)
    }
  },

  startOnboarding: async () => {
    const { passphrase } = await invoke<{ passphrase: string }>('start_sync_onboarding')
    return passphrase
  },

  completeOnboarding: async (passphrase: string) => {
    const info = await invoke<SyncSetupStateInfo>('complete_sync_onboarding', { passphrase })
    set({ info, lockedEvent: false })
  },

  declineOnboarding: async () => {
    const info = await invoke<SyncSetupStateInfo>('decline_sync_onboarding')
    set({ info, lockedEvent: false })
  },

  unlock: async (passphrase: string) => {
    const info = await invoke<SyncSetupStateInfo>('unlock_sync', { passphrase })
    set({ info, lockedEvent: false })
  },

  enable: async () => {
    const info = await invoke<SyncSetupStateInfo>('enable_sync')
    set({ info, lockedEvent: info.needs_passphrase })
  },

  tryJoin: async () => {
    const info = await invoke<SyncSetupStateInfo>('try_join_sync')
    set({ info, lockedEvent: false })
  },

  disable: async (deleteCloudData: boolean) => {
    const summary = await invoke<string>('disable_sync', { deleteCloudData })
    const info = await invoke<SyncSetupStateInfo>('get_sync_setup_state')
    // Any disable clears a stale locked banner: the ladder re-runs on the
    // next pass and re-arms it if the passphrase rung is genuinely reached
    // (audit 2026-08-28, M9 — the ghost banner after delete-cloud-data).
    set({ info, lockedEvent: info.needs_passphrase })
    return summary
  },

  syncNow: async () => {
    const result = await invoke<SyncNowResultInfo>('sync_now')
    const info = await invoke<SyncSetupStateInfo>('get_sync_setup_state')
    set({ info })
    return result
  },

  forcePublish: async () => {
    const result = await invoke<SyncNowResultInfo>('force_sync_publish')
    const info = await invoke<SyncSetupStateInfo>('get_sync_setup_state')
    set({ info })
    return result
  },
}))

/** Release the store's Tauri event listeners (test/teardown hook). */
export function releaseSyncSetupListeners(): void {
  unsubscribeLocked?.()
  unsubscribeError?.()
  unsubscribeLocked = null
  unsubscribeError = null
  listenersRegistered = false
  listenersReady = null
}
