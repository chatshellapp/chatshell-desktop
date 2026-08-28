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

export const useSyncSetupStore = create<SyncSetupStore>((set, get) => ({
  info: null,
  lockedEvent: false,

  load: async () => {
    try {
      const info = await invoke<SyncSetupStateInfo>('get_sync_setup_state')
      set({ info, lockedEvent: info.needs_passphrase })
      if (!unsubscribeLocked) {
        unsubscribeLocked = await listen('sync-locked', () => {
          set({ lockedEvent: true })
          const current = get().info
          if (current) set({ info: { ...current, needs_passphrase: true } })
        })
        await listen<string>('sync-error', (event) => {
          const current = get().info
          if (current) set({ info: { ...current, last_pass_error: event.payload } })
        })
      }
    } catch (err) {
      logger.error('Failed to load sync setup state:', err)
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
    set({ info })
  },

  unlock: async (passphrase: string) => {
    const info = await invoke<SyncSetupStateInfo>('unlock_sync', { passphrase })
    set({ info, lockedEvent: false })
  },

  enable: async () => {
    const info = await invoke<SyncSetupStateInfo>('enable_sync')
    set({ info })
  },

  tryJoin: async () => {
    const info = await invoke<SyncSetupStateInfo>('try_join_sync')
    set({ info, lockedEvent: false })
  },

  disable: async (deleteCloudData: boolean) => {
    const summary = await invoke<string>('disable_sync', { deleteCloudData })
    const info = await invoke<SyncSetupStateInfo>('get_sync_setup_state')
    set({ info })
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
