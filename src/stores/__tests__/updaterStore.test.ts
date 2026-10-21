import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import type { Update } from '@tauri-apps/plugin-updater'
import { compareVersions, useUpdaterStore } from '../updaterStore'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('0.8.3'),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
  },
}))

const mockInvoke = vi.mocked(invoke)
const mockCheck = vi.mocked(check)
const mockRelaunch = vi.mocked(relaunch)

type FakeUpdate = {
  version: string
  currentVersion: string
  body: string
  close: Mock
  download: Mock
  install: Mock
}

const makeUpdate = (version: string): FakeUpdate & Update =>
  ({
    version,
    currentVersion: '0.8.3',
    body: 'release notes',
    close: vi.fn(),
    download: vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } })
      onEvent({ event: 'Progress', data: { chunkLength: 40 } })
      onEvent({ event: 'Progress', data: { chunkLength: 60 } })
    }),
    install: vi.fn().mockResolvedValue(undefined),
  }) as FakeUpdate & Update

// Settings table contents returned by `get_setting`.
let settingsBykey: Record<string, string> = {}

describe('useUpdaterStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsBykey = {}
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'get_setting') {
        const key = (args as { key?: string } | undefined)?.key
        if (key) return settingsBykey[key] ?? null
      }
      if (cmd === 'set_setting') {
        const setArgs = args as { key: string; value: string }
        settingsBykey[setArgs.key] = setArgs.value
        return null
      }
      return null
    })
    useUpdaterStore.setState({
      status: 'idle',
      update: null,
      currentVersion: null,
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
      autoCheckEnabled: true,
      skippedVersion: null,
    })
  })

  describe('compareVersions', () => {
    it('orders patch releases correctly', () => {
      expect(compareVersions('0.9.0', '0.8.3')).toBeGreaterThan(0)
      expect(compareVersions('0.8.2', '0.8.3')).toBeLessThan(0)
      expect(compareVersions('0.8.3', '0.8.3')).toBe(0)
    })

    it('compares numerically, not lexically', () => {
      expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    })

    it('treats missing parts as zero', () => {
      expect(compareVersions('0.8', '0.8.0')).toBe(0)
      expect(compareVersions('0.8', '0.8.1')).toBeLessThan(0)
    })

    it('falls back to zero on non-numeric parts', () => {
      expect(compareVersions('x.y.z', '0.0.0')).toBe(0)
    })
  })

  describe('loadPreferences', () => {
    it('defaults auto-check to on when the setting is absent', async () => {
      await useUpdaterStore.getState().loadPreferences()
      const state = useUpdaterStore.getState()
      expect(state.autoCheckEnabled).toBe(true)
      expect(state.currentVersion).toBe('0.8.3')
      expect(state.skippedVersion).toBeNull()
    })

    it('respects an explicit opt-out and a skipped version', async () => {
      settingsBykey['updater.auto_check'] = 'false'
      settingsBykey['updater.skipped_version'] = '0.9.0'
      await useUpdaterStore.getState().loadPreferences()
      const state = useUpdaterStore.getState()
      expect(state.autoCheckEnabled).toBe(false)
      expect(state.skippedVersion).toBe('0.9.0')
    })
  })

  describe('runStartupCheck', () => {
    it('skips the network check when auto-check is off', async () => {
      settingsBykey['updater.auto_check'] = 'false'
      await useUpdaterStore.getState().runStartupCheck()
      expect(mockCheck).not.toHaveBeenCalled()
    })

    it('checks silently when auto-check is on', async () => {
      mockCheck.mockResolvedValue(null)
      await useUpdaterStore.getState().runStartupCheck()
      expect(mockCheck).toHaveBeenCalledTimes(1)
    })
  })

  describe('checkForUpdates', () => {
    it('clears state and returns null when up to date', async () => {
      useUpdaterStore.setState({ update: makeUpdate('0.9.0') })
      mockCheck.mockResolvedValue(null)
      const found = await useUpdaterStore.getState().checkForUpdates({ silent: false })
      expect(found).toBeNull()
      expect(useUpdaterStore.getState().update).toBeNull()
      expect(useUpdaterStore.getState().status).toBe('idle')
    })

    it('honors a skipped version until a strictly greater one ships', async () => {
      const skipped = makeUpdate('0.9.0')
      useUpdaterStore.setState({ skippedVersion: '0.9.0' })
      mockCheck.mockResolvedValue(skipped as Update)
      const foundSame = await useUpdaterStore.getState().checkForUpdates({ silent: true })
      expect(foundSame).toBeNull()
      expect(useUpdaterStore.getState().update).toBeNull()
      expect(skipped.close).toHaveBeenCalled()

      const newer = makeUpdate('0.9.1')
      mockCheck.mockResolvedValue(newer as Update)
      const foundNewer = await useUpdaterStore.getState().checkForUpdates({ silent: true })
      expect(foundNewer).toBe(newer)
      expect(useUpdaterStore.getState().update).toBe(newer)
    })

    it('surfaces errors only for manual checks', async () => {
      mockCheck.mockRejectedValue(new Error('network down'))
      await useUpdaterStore.getState().checkForUpdates({ silent: true })
      expect(useUpdaterStore.getState().error).toBeNull()

      await useUpdaterStore.getState().checkForUpdates({ silent: false })
      expect(useUpdaterStore.getState().error).toContain('network down')
      expect(useUpdaterStore.getState().status).toBe('idle')
    })
  })

  describe('downloadUpdate + installAndRestart', () => {
    it('tracks progress, reaches ready, then installs and relaunches', async () => {
      const update = makeUpdate('0.9.0')
      useUpdaterStore.setState({ update })
      await useUpdaterStore.getState().downloadUpdate()
      const downloaded = useUpdaterStore.getState()
      expect(downloaded.status).toBe('ready')
      expect(downloaded.totalBytes).toBe(100)
      expect(downloaded.downloadedBytes).toBe(100)
      expect(update.download).toHaveBeenCalled()

      await useUpdaterStore.getState().installAndRestart()
      expect(update.install).toHaveBeenCalled()
      expect(mockRelaunch).toHaveBeenCalled()
    })

    it('resets to idle on download failure and keeps the update discovered', async () => {
      const update = makeUpdate('0.9.0')
      update.download.mockRejectedValue(new Error('disk full'))
      useUpdaterStore.setState({ update })
      await useUpdaterStore.getState().downloadUpdate()
      const state = useUpdaterStore.getState()
      expect(state.status).toBe('idle')
      expect(state.error).toContain('disk full')
      expect(state.update).toBe(update)
    })
  })

  describe('setAutoCheck + skipCurrentVersion', () => {
    it('persists preferences through the settings table', async () => {
      await useUpdaterStore.getState().setAutoCheck(false)
      expect(settingsBykey['updater.auto_check']).toBe('false')

      useUpdaterStore.setState({ update: makeUpdate('0.9.0') })
      await useUpdaterStore.getState().skipCurrentVersion()
      expect(settingsBykey['updater.skipped_version']).toBe('0.9.0')
      expect(useUpdaterStore.getState().update).toBeNull()
    })
  })
})
