import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DefaultPermissionMode } from '../default-permission-mode'
import { useSettingsStore } from '@/stores/settingsStore'
import { resetSandboxStatusForTests } from '@/lib/permission-mode'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

function mockBackend(sandbox: boolean) {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'get_sandbox_status') return { available: sandbox, backend: null }
    return undefined
  })
}

describe('DefaultPermissionMode', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetSandboxStatusForTests()
    useSettingsStore.setState({ settings: {} })
  })

  it('starts in ask when nothing is set', async () => {
    mockBackend(true)
    render(<DefaultPermissionMode />)
    expect(screen.getByRole('radio', { name: /^ask/i })).toBeChecked()
    await waitFor(() => expect(screen.getByRole('radio', { name: /^auto/i })).toBeInTheDocument())
  })

  it('offers auto on every platform and shows a stored auto as auto', async () => {
    mockBackend(false)
    useSettingsStore.setState({ settings: { default_permission_mode: 'auto' } })
    render(<DefaultPermissionMode />)
    expect(await screen.findByRole('radio', { name: /^auto/i })).toBeChecked()
    expect(screen.getByText(/an ai reviewer approves safe actions/i)).toBeInTheDocument()
  })

  it('names concrete consequences before saving yolo', async () => {
    mockBackend(true)
    render(<DefaultPermissionMode />)
    ;(await screen.findByRole('radio', { name: /^yolo/i })).click()
    expect(
      await screen.findByText(/read, write, and delete files anywhere your account can/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/use the network/i)).toBeInTheDocument()
    expect(screen.getByText(/no review of individual actions/i)).toBeInTheDocument()
  })

  it('saves auto directly but asks before saving yolo', async () => {
    mockBackend(true)
    render(<DefaultPermissionMode />)
    const auto = await screen.findByRole('radio', { name: /^auto/i })
    auto.click()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_setting', {
        key: 'default_permission_mode',
        value: 'auto',
      })
    )
    invoke.mockClear()
    screen.getByRole('radio', { name: /^yolo/i }).click()
    const confirm = await screen.findByRole('button', { name: /allow full access/i })
    expect(invoke).not.toHaveBeenCalledWith('set_setting', expect.anything())
    confirm.click()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_setting', {
        key: 'default_permission_mode',
        value: 'yolo',
      })
    )
  })

  it('describes ask by platform: sandboxed commands run silently, file edits still ask', async () => {
    mockBackend(true)
    render(<DefaultPermissionMode />)
    expect(
      await screen.findByText(
        /commands run in a sandbox; confirms escapes, file edits, and tool use/i
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/edits made with the file tools are always confirmed/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/confirm every command/i)).not.toBeInTheDocument()
  })

  it('describes ask as per-command confirmation without a sandbox', async () => {
    mockBackend(false)
    render(<DefaultPermissionMode />)
    expect(
      await screen.findByText(/confirm every command, file edit, and tool use/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/commands run in a sandbox/i)).not.toBeInTheDocument()
  })
})
