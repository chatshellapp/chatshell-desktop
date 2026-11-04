import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { RememberedApprovals } from '../remembered-approvals'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('RememberedApprovals', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('shows the remembered count and clears it', async () => {
    let remembered = 3
    invoke.mockImplementation(async (command: string) => {
      if (command === 'count_permission_grants') return remembered
      if (command === 'clear_permission_grants') {
        const removed = remembered
        remembered = 0
        return removed
      }
      throw new Error(`unexpected ${command}`)
    })
    render(<RememberedApprovals />)
    await waitFor(() =>
      expect(screen.getByTestId('remembered-approvals-count')).toHaveTextContent('3')
    )
    screen.getByRole('button', { name: /forget all/i }).click()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('clear_permission_grants'))
    await waitFor(() =>
      expect(screen.getByTestId('remembered-approvals-count')).toHaveTextContent('0')
    )
    expect(screen.getByRole('button', { name: /forget all/i })).toBeDisabled()
  })
})
