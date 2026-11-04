import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BashEnvironment } from '../bash-environment'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('BashEnvironment', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('adds a suggested variable and removes a passed-through one', async () => {
    let passthrough = ['SSH_AUTH_SOCK']
    invoke.mockImplementation(async (command: string, args?: { passthrough: string[] }) => {
      if (command === 'set_bash_environment') passthrough = args!.passthrough
      return {
        allowlist: ['PATH', 'HOME'],
        passthrough,
        suggestions: ['JAVA_HOME'].filter((name) => !passthrough.includes(name)),
      }
    })
    render(<BashEnvironment />)
    await waitFor(() =>
      expect(screen.getByTestId('bash-env-passthrough')).toHaveTextContent('SSH_AUTH_SOCK')
    )

    screen.getByRole('button', { name: /JAVA_HOME/ }).click()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_bash_environment', {
        passthrough: ['SSH_AUTH_SOCK', 'JAVA_HOME'],
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId('bash-env-passthrough')).toHaveTextContent('JAVA_HOME')
    )

    screen.getByRole('button', { name: /remove SSH_AUTH_SOCK/i }).click()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_bash_environment', {
        passthrough: ['JAVA_HOME'],
      })
    )
  })
})
