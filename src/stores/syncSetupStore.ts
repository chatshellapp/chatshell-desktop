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
  rotateKey: (passphrase: string) => Promise<string>
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

  rotateKey: async (passphrase: string) => {
    return invoke<string>('rotate_sync_key', { passphrase })
  },
}))
