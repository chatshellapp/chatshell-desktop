import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { ProducedFilesRow } from '../ProducedFilesRow'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

void i18n

const files = [
  { path: '/work/src/main.rs', role: 'created' as const },
  { path: '/work/README.md', role: 'modified' as const },
]

describe('ProducedFilesRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reveals a file on click', async () => {
    vi.mocked(invoke).mockResolvedValue([])
    render(<ProducedFilesRow files={files} />)
    fireEvent.click(screen.getByText('main.rs'))
    await waitFor(() => expect(revealItemInDir).toHaveBeenCalledWith('/work/src/main.rs'))
  })

  it('offers undo when backups exist and restores after a confirming click', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_turn_file_history') return [{ path: '/work/README.md', existed: true }]
      if (cmd === 'restore_turn_files')
        return { restored: ['/work/README.md'], removed: ['/work/src/main.rs'], failed: [] }
      return null
    })
    render(<ProducedFilesRow files={files} conversationId="conv" turnId="user-1" />)

    const undo = await screen.findByText('Undo file changes')
    fireEvent.click(undo)
    expect(invoke).not.toHaveBeenCalledWith('restore_turn_files', expect.anything())
    fireEvent.click(screen.getByText('Click again to undo'))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('restore_turn_files', {
        conversationId: 'conv',
        userMessageId: 'user-1',
      })
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Restored 2 file(s)', expect.anything())
    )
    expect(screen.queryByText('Undo file changes')).toBeNull()
  })

  it('hides undo when this device has no backups', async () => {
    vi.mocked(invoke).mockResolvedValue([])
    render(<ProducedFilesRow files={files} conversationId="conv" turnId="user-1" />)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('get_turn_file_history', {
        conversationId: 'conv',
        userMessageId: 'user-1',
      })
    )
    expect(screen.queryByText('Undo file changes')).toBeNull()
  })
})
