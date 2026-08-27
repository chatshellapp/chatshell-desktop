import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import i18n from '@/lib/i18n'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useSyncSetupStore, type SyncSetupStateInfo } from '@/stores/syncSetupStore'
import { useModelStore } from '@/stores/modelStore'
import type { Model, Provider } from '@/types'
import { SyncOnboardingDialog } from '@/components/sync/sync-onboarding-dialog'
import { OnboardingDialog } from '@/components/onboarding-dialog'

const mockedInvoke = vi.mocked(invoke)

function syncInfo(overrides: Partial<SyncSetupStateInfo> = {}): SyncSetupStateInfo {
  return {
    enabled: false,
    onboarded: false,
    needs_onboarding: true,
    needs_passphrase: false,
    container_available: true,
    group_exists: false,
    engine_active: false,
    ...overrides,
  }
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'model-1',
    name: 'Llama 3',
    provider_id: 'provider-1',
    model_id: 'llama3',
    is_starred: false,
    is_deleted: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    provider_type: 'openai',
    is_enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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

/** Both surfaces mounted exactly as ChatPage mounts them. */
function renderDialogs() {
  return render(
    <>
      <OnboardingDialog />
      <SyncOnboardingDialog />
    </>
  )
}

describe('onboarding flow: provider stage -> embedded sync step', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    mockedInvoke.mockReset()
    useSyncSetupStore.setState({ info: null, lockedEvent: false })
    useModelStore.setState({ models: [], providers: [] })
    useOnboardingStore.setState({
      step: 'checking',
      isDialogOpen: false,
      flowOwnsSyncOffer: false,
    })
  })

  it('goes straight to the sync card for explicitly configured providers', async () => {
    mockInvokeByCommand({ get_setting: null, set_setting: undefined })
    // The provider choice was already made (e.g. a cloud provider
    // configured before) — the provider stage is satisfied.
    useModelStore.setState({ models: [makeModel()], providers: [makeProvider()] })
    useSyncSetupStore.setState({ info: syncInfo() })
    useOnboardingStore.setState({ isDialogOpen: true, flowOwnsSyncOffer: true })

    renderDialogs()

    expect(await screen.findByText('Sync your chats across devices')).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(useOnboardingStore.getState().step).toBe('sync')
    expect(mockedInvoke).toHaveBeenCalledWith('set_setting', {
      key: 'onboarding_complete',
      value: 'true',
    })
  })

  it('shows the local-ready step for auto-imported Ollama models, then continues to sync', async () => {
    mockInvokeByCommand({ get_setting: null, set_setting: undefined })
    const ollama = makeProvider({ id: 'provider-ollama', provider_type: 'ollama', name: 'Ollama' })
    useModelStore.setState({
      models: [
        makeModel({ id: 'm1', name: 'Llama 3', provider_id: 'provider-ollama' }),
        makeModel({ id: 'm2', name: 'Qwen 3', provider_id: 'provider-ollama' }),
      ],
      providers: [ollama],
    })
    useSyncSetupStore.setState({ info: syncInfo() })
    useOnboardingStore.setState({ isDialogOpen: true, flowOwnsSyncOffer: true })

    renderDialogs()

    // Detected + auto-imported: acknowledge, but keep the provider stage
    // visible ("Add More Providers") instead of silently skipping it.
    expect(await screen.findByText('Ollama is ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add more providers/i })).toBeInTheDocument()
    expect(useOnboardingStore.getState().step).toBe('local-ready')
    expect(screen.queryByText('Sync your chats across devices')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText('Sync your chats across devices')).toBeInTheDocument()
    expect(useOnboardingStore.getState().step).toBe('sync')
    expect(mockedInvoke).toHaveBeenCalledWith('set_setting', {
      key: 'onboarding_complete',
      value: 'true',
    })
  })

  it('stops at the provider step when no model is usable', async () => {
    mockInvokeByCommand({ get_setting: null })
    useOnboardingStore.setState({ isDialogOpen: true, flowOwnsSyncOffer: true })

    renderDialogs()

    expect(await screen.findByText('Configure a provider to get started')).toBeInTheDocument()
    expect(useOnboardingStore.getState().step).toBe('no-provider')
    expect(screen.queryByText('Sync your chats across devices')).toBeNull()
  })

  it('finishes without the sync step when the backend does not want the offer', async () => {
    mockInvokeByCommand({ get_setting: null, set_setting: undefined })
    useModelStore.setState({ models: [makeModel()] })
    useSyncSetupStore.setState({
      info: syncInfo({ onboarded: true, needs_onboarding: false }),
    })
    useOnboardingStore.setState({ isDialogOpen: true, flowOwnsSyncOffer: true })

    renderDialogs()

    await waitFor(() => expect(useOnboardingStore.getState().isDialogOpen).toBe(false))
    expect(useOnboardingStore.getState().step).toBe('complete')
    expect(mockedInvoke).toHaveBeenCalledWith('set_setting', {
      key: 'onboarding_complete',
      value: 'true',
    })
  })
})

describe('sync onboarding embedded in the general onboarding flow', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    mockedInvoke.mockReset()
    useSyncSetupStore.setState({ info: null, lockedEvent: false })
  })

  it('renders the sync card as the flow step, not a stacked second dialog', async () => {
    useSyncSetupStore.setState({ info: syncInfo() })
    useOnboardingStore.setState({
      step: 'sync',
      isDialogOpen: true,
      flowOwnsSyncOffer: true,
    })

    renderDialogs()

    const dialogs = await screen.findAllByRole('dialog')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].textContent).toContain('Sync your chats across devices')
  })

  it('declining in the flow closes it and defers the re-ask to the next launch', async () => {
    // State after a first decline: re-ask budget not yet exhausted.
    mockInvokeByCommand({ decline_sync_onboarding: syncInfo({ needs_onboarding: true }) })
    useSyncSetupStore.setState({ info: syncInfo() })
    useOnboardingStore.setState({
      step: 'sync',
      isDialogOpen: true,
      flowOwnsSyncOffer: true,
    })

    renderDialogs()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    await waitFor(() => expect(useOnboardingStore.getState().isDialogOpen).toBe(false))
    // The standalone launch-time card must not pop over the just-finished
    // flow (ADR 04 §7: the re-ask happens at the NEXT launch).
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(useSyncSetupStore.getState().info?.needs_onboarding).toBe(true)
  })

  it('enabling in the flow completes bootstrap and closes the flow', async () => {
    mockInvokeByCommand({
      start_sync_onboarding: { passphrase: 'alpha bravo charlie delta echo' },
      complete_sync_onboarding: syncInfo({
        enabled: true,
        onboarded: true,
        needs_onboarding: false,
        engine_active: true,
      }),
    })
    useSyncSetupStore.setState({ info: syncInfo() })
    useOnboardingStore.setState({
      step: 'sync',
      isDialogOpen: true,
      flowOwnsSyncOffer: true,
    })

    renderDialogs()
    fireEvent.click(screen.getByRole('button', { name: /set up encryption/i }))
    expect(await screen.findByText('alpha bravo charlie delta echo')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /turn on sync/i }))

    await waitFor(() => expect(useOnboardingStore.getState().isDialogOpen).toBe(false))
    expect(useOnboardingStore.getState().step).toBe('complete')
    expect(useSyncSetupStore.getState().info?.enabled).toBe(true)
  })

  it('silently joins an existing group from the flow step and closes it', async () => {
    mockInvokeByCommand({
      try_join_sync: syncInfo({
        enabled: true,
        onboarded: true,
        needs_onboarding: false,
        group_exists: true,
      }),
    })
    useSyncSetupStore.setState({ info: syncInfo({ group_exists: true }) })
    useOnboardingStore.setState({
      step: 'sync',
      isDialogOpen: true,
      flowOwnsSyncOffer: true,
    })

    renderDialogs()

    await waitFor(() => expect(useOnboardingStore.getState().isDialogOpen).toBe(false))
    expect(useSyncSetupStore.getState().info?.needs_onboarding).toBe(false)
  })

  it('shows the standalone card when the general flow does not own the offer', async () => {
    // Upgrade path: general onboarding finished long ago, sync is new.
    useSyncSetupStore.setState({ info: syncInfo() })
    useOnboardingStore.setState({
      step: 'checking',
      isDialogOpen: false,
      flowOwnsSyncOffer: false,
    })

    renderDialogs()

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Sync your chats across devices')
  })
})
