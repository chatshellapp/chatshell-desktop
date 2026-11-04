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

  it('hides auto without a sandbox and shows a stored auto as ask', async () => {
    mockBackend(false)
    useSettingsStore.setState({ settings: { default_permission_mode: 'auto' } })
    render(<DefaultPermissionMode />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_sandbox_status'))
    expect(screen.queryByRole('radio', { name: /^auto/i })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^ask/i })).toBeChecked()
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
})
