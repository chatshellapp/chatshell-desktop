import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PermissionsSettings } from '../permissions-settings'
import { resetSandboxStatusForTests } from '@/lib/permission-mode'
import { useSettingsStore } from '@/stores/settingsStore'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function mockBackend(sandbox: { available: boolean; backend: string | null }) {
  invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case 'get_sandbox_status':
        return sandbox
      case 'count_permission_grants':
        return 0
      case 'get_bash_environment':
        return { allowlist: ['PATH'], passthrough: [], suggestions: [] }
      default:
        return null
    }
  })
}

describe('PermissionsSettings', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetSandboxStatusForTests()
    useSettingsStore.setState({ settings: {} })
  })

  it('shows the sandbox backend and every permission card', async () => {
    mockBackend({ available: true, backend: 'seatbelt' })
    render(<PermissionsSettings />)
    expect(await screen.findByTestId('sandbox-status-badge')).toHaveTextContent('macOS Seatbelt')
    expect(screen.getByText('Default permission mode')).toBeInTheDocument()
    expect(await screen.findByText('Remembered approvals')).toBeInTheDocument()
    expect(await screen.findByText('Bash environment')).toBeInTheDocument()
  })

  it('keeps auto without a sandbox and explains how it runs there', async () => {
    mockBackend({ available: false, backend: null })
    render(<PermissionsSettings />)
    expect(await screen.findByTestId('sandbox-status-badge')).toHaveTextContent('Not available')
    expect(
      screen.getByText(/every terminal command is reviewed before it runs/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^auto/i })).toBeInTheDocument()
    expect(screen.queryByText(/requires a sandbox/i)).not.toBeInTheDocument()
  })
})
