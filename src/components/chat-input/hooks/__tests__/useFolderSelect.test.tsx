import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { useFolderSelect } from '../useFolderSelect'
import type { Attachment } from '../../types'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

void i18n

describe('useFolderSelect', () => {
  let attachments: Attachment[]
  let setAttachments: (update: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void

  beforeEach(() => {
    vi.clearAllMocks()
    attachments = []
    setAttachments = (update) => {
      attachments = typeof update === 'function' ? update(attachments) : update
    }
  })

  function renderSelect() {
    return renderHook(() => useFolderSelect(setAttachments)).result.current
  }

  it('attaches a folder as its listing, named with a trailing slash', async () => {
    vi.mocked(open).mockResolvedValue('/work/project/')
    vi.mocked(invoke).mockResolvedValue('Folder: /work/project\nsrc/\n')
    const { handleFolderSelect } = renderSelect()

    await act(async () => handleFolderSelect())

    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false })
    expect(invoke).toHaveBeenCalledWith('list_folder_for_attachment', { path: '/work/project/' })
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      type: 'file',
      name: 'project/',
      content: 'Folder: /work/project\nsrc/\n',
      mimeType: 'text/plain',
    })
  })

  it('cancel attaches nothing', async () => {
    vi.mocked(open).mockResolvedValue(null)
    const { handleFolderSelect } = renderSelect()

    await act(async () => handleFolderSelect())

    expect(invoke).not.toHaveBeenCalled()
    expect(attachments).toEqual([])
  })

  it('a listing failure toasts the folder name', async () => {
    vi.mocked(open).mockResolvedValue('/private/vault')
    vi.mocked(invoke).mockRejectedValue(new Error('Read blocked'))
    const { handleFolderSelect } = renderSelect()

    await act(async () => handleFolderSelect())

    expect(attachments).toEqual([])
    expect(toast.error).toHaveBeenCalledWith('Failed to read: vault', {
      description: 'Read blocked',
    })
  })
})
