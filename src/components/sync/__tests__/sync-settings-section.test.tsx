import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import i18n from '@/lib/i18n'
import { useSyncSetupStore, type SyncSetupStateInfo } from '@/stores/syncSetupStore'
import { SyncSettingsSection } from '@/components/sync/sync-settings-section'

const mockedInvoke = vi.mocked(invoke)

function syncInfo(overrides: Partial<SyncSetupStateInfo> = {}): SyncSetupStateInfo {
  return {
    enabled: false,
    onboarded: false,
    needs_onboarding: false,
    needs_passphrase: false,
    container_available: true,
    group_exists: false,
    engine_active: false,
    last_pass_error: null,
    ...overrides,
  }
}

function mockInvokeByCommand(results: Record<string, unknown>) {
  mockedInvoke.mockImplementation(((
    cmd: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) =>
    cmd in results
      ? results[cmd]
      : Promise.reject(new Error(`unexpected command ${cmd}`))) as never)
}

describe('SyncSettingsSection', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    mockedInvoke.mockReset()
    useSyncSetupStore.setState({ info: null, lockedEvent: false })
  })

  it('offers the full onboarding card to a user who declined the launch ask', async () => {
    // Re-ask budget spent (declined twice): no dialog will ever show
    // again, so the settings entry must carry the whole consent +
    // passphrase bootstrap flow, not a bare enable toggle.
    mockInvokeByCommand({
      start_sync_onboarding: { passphrase: 'alpha bravo charlie delta echo' },
      complete_sync_onboarding: syncInfo({ enabled: true, onboarded: true, engine_active: true }),
    })
    useSyncSetupStore.setState({ info: syncInfo() })

    render(<SyncSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Turn on sync' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Sync your chats across devices')
    fireEvent.click(within(dialog).getByRole('button', { name: /set up encryption/i }))
    expect(await within(dialog).findByText('alpha bravo charlie delta echo')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: /turn on sync/i }))

    await waitFor(() => expect(useSyncSetupStore.getState().info?.enabled).toBe(true))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Sync is on.')).toBeInTheDocument()
  })

  it('re-enables directly for a previously onboarded user (stop-publishing path)', async () => {
    mockInvokeByCommand({ enable_sync: syncInfo({ enabled: true, onboarded: true }) })
    useSyncSetupStore.setState({ info: syncInfo({ onboarded: true }) })

    render(<SyncSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Turn on sync' }))

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith('enable_sync'))
    await waitFor(() => expect(screen.getByText('Sync is on.')).toBeInTheDocument())
  })

  it('offers no entry without an iCloud account, only the hint', () => {
    useSyncSetupStore.setState({
      info: syncInfo({ container_available: false }),
    })

    render(<SyncSettingsSection />)

    expect(screen.queryByRole('button', { name: 'Turn on sync' })).toBeNull()
    expect(screen.getByText(/iCloud Drive is not available on this device/)).toBeInTheDocument()
  })

  it('renders neither entry nor unavailable hint while sync info is unknown', () => {
    // info null = initial load window or a failed get_sync_setup_state:
    // availability is unknown, so the iCloud-required hint must not render.
    useSyncSetupStore.setState({ info: null })

    render(<SyncSettingsSection />)

    expect(screen.queryByRole('button', { name: 'Turn on sync' })).toBeNull()
    expect(screen.queryByText(/iCloud Drive is not available on this device/)).toBeNull()
    expect(screen.getByText('Sync is off.')).toBeInTheDocument()
  })

  it('re-resolves the sync state on mount so a mid-session iCloud sign-in shows the entry', async () => {
    // Stale launch-time info says no container; the user then signs into
    // iCloud and opens Settings — the mount refresh must flip the state
    // and reveal the onboarding entry.
    mockInvokeByCommand({
      get_sync_setup_state: syncInfo({ container_available: true }),
    })
    useSyncSetupStore.setState({ info: syncInfo({ container_available: false }) })

    render(<SyncSettingsSection />)

    expect(await screen.findByRole('button', { name: 'Turn on sync' })).toBeInTheDocument()
    expect(screen.queryByText(/iCloud Drive is not available on this device/)).toBeNull()
  })
})
