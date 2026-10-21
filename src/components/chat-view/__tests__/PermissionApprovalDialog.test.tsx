import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { PermissionApprovalDialog } from '../PermissionApprovalDialog'
import { usePermissionStore } from '@/stores/permissionStore'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

function seedPending(allowSession = true) {
  usePermissionStore.getState().show({
    requestId: 'req-1',
    conversationId: 'conv-1',
    toolName: 'bash',
    subject: 'cargo test',
    tier: 'exec',
    allowSession,
  })
}

describe('PermissionApprovalDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePermissionStore.getState().clear()
    invoke.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing without a pending request', () => {
    const { container } = render(<PermissionApprovalDialog />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows tool and subject with buttons disarmed, then arms after the delay', () => {
    vi.useFakeTimers()
    seedPending()
    render(<PermissionApprovalDialog />)

    expect(screen.getByText('cargo test')).toBeInTheDocument()
    const deny = screen.getByRole('button', { name: /deny/i })
    const allowOnce = screen.getByRole('button', { name: /allow once/i })
    expect(deny).toBeDisabled()
    expect(allowOnce).toBeDisabled()

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(deny).toBeEnabled()
    expect(allowOnce).toBeEnabled()
    expect(screen.getByRole('button', { name: /allow for this session/i })).toBeInTheDocument()
  })

  it('answers deny and clears the pending request', async () => {
    seedPending()
    render(<PermissionApprovalDialog />)
    const deny = await waitFor(() => {
      const button = screen.getByRole('button', { name: /deny/i })
      expect(button).toBeEnabled()
      return button
    })
    deny.click()

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_permission', {
        request: { requestId: 'req-1', decision: 'deny' },
      })
    )
    expect(usePermissionStore.getState().pending).toBeNull()
  })

  it('answers allow-session when the grant scope allows it', async () => {
    seedPending(true)
    render(<PermissionApprovalDialog />)
    const session = await waitFor(() => {
      const button = screen.getByRole('button', { name: /allow for this session/i })
      expect(button).toBeEnabled()
      return button
    })
    session.click()

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_permission', {
        request: { requestId: 'req-1', decision: 'allow-session' },
      })
    )
  })

  it('hides the session button when the backend reports no session scope', async () => {
    seedPending(false)
    render(<PermissionApprovalDialog />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /allow once/i })).toBeEnabled()
    )
    expect(
      screen.queryByRole('button', { name: /allow for this session/i })
    ).not.toBeInTheDocument()
  })
})
