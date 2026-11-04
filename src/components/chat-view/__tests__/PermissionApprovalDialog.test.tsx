import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { PermissionApprovalDialog } from '../PermissionApprovalDialog'
import { usePermissionStore, type PermissionGrant } from '@/stores/permissionStore'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

function seedPending(grant: PermissionGrant | null = { kind: 'bash', bases: ['cargo'] }) {
  usePermissionStore.getState().show({
    requestId: 'req-1',
    conversationId: 'conv-1',
    toolName: 'bash',
    subject: 'cargo test',
    tier: 'exec',
    grant,
  })
}

describe('PermissionApprovalDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePermissionStore.getState().reset()
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
    expect(usePermissionStore.getState().pending).toEqual([])
  })

  it('answers allow-session when the grant scope allows it', async () => {
    seedPending()
    render(<PermissionApprovalDialog />)
    expect(screen.getByText(/auto-approves commands/)).toBeInTheDocument()
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
    seedPending(null)
    render(<PermissionApprovalDialog />)
    await waitFor(() => expect(screen.getByRole('button', { name: /allow once/i })).toBeEnabled())
    expect(
      screen.queryByRole('button', { name: /allow for this session/i })
    ).not.toBeInTheDocument()
  })

  it('queues concurrent requests: shows the oldest first, then the next after answering', async () => {
    seedPending()
    usePermissionStore.getState().show({
      requestId: 'req-2',
      conversationId: 'conv-1',
      toolName: 'write',
      subject: '/tmp/b.txt',
      tier: 'write',
      grant: { kind: 'tool', tool: 'write' },
    })
    render(<PermissionApprovalDialog />)

    expect(screen.getByText('cargo test')).toBeInTheDocument()
    expect(screen.getByText('1 more approval request(s) waiting')).toBeInTheDocument()
    expect(screen.queryByText('/tmp/b.txt')).not.toBeInTheDocument()

    const deny = await waitFor(() => {
      const button = screen.getByRole('button', { name: /deny/i })
      expect(button).toBeEnabled()
      return button
    })
    deny.click()

    await waitFor(() => expect(screen.getByText('/tmp/b.txt')).toBeInTheDocument())
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_permission', {
        request: { requestId: 'req-1', decision: 'deny' },
      })
    )
  })

  it('shows the warning line for a forced prompt and offers no session grant', async () => {
    usePermissionStore.getState().show({
      requestId: 'req-w',
      conversationId: 'conv-1',
      toolName: 'bash',
      subject: 'curl https://example.com',
      tier: 'exec',
      grant: null,
      warning: { kind: 'network', detail: 'curl -> example.com' },
    })
    render(<PermissionApprovalDialog />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This command contacts a remote host over the network.'
    )
    expect(screen.getByText('curl -> example.com')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /allow once/i })).toBeEnabled())
    expect(
      screen.queryByRole('button', { name: /allow for this session/i })
    ).not.toBeInTheDocument()
  })

  it('renders no warning line for an ordinary prompt', () => {
    seedPending()
    render(<PermissionApprovalDialog />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
