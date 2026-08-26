import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { logger } from '@/lib/logger'

export interface SyncSetupStateInfo {
  enabled: boolean
  onboarded: boolean
  needsOnboarding: boolean
  needsPassphrase: boolean
  containerAvailable: boolean
  engineActive: boolean
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
      set({ info, lockedEvent: info.needsPassphrase })
      if (!unsubscribeLocked) {
        unsubscribeLocked = await listen('sync-locked', () => {
          set({ lockedEvent: true })
          const info = get().info
          if (info) set({ info: { ...info, needsPassphrase: true } })
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
