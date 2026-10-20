import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { logger } from '@/lib/logger'
import { useImageSelect } from '../useImageSelect'
import type { Attachment } from '../../types'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Base64 of bytes [0, 1, 2]: estimated size is floor(4 * 3 / 4) = 3
const BYTES_B64 = 'AAEC'

describe('useImageSelect', () => {
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
    return renderHook(() => useImageSelect(setAttachments)).result.current
  }

  it('opens a multi-select dialog filtered to the supported image extensions', async () => {
    vi.mocked(open).mockResolvedValue(null)
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    expect(open).toHaveBeenCalledWith({
      multiple: true,
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
        },
      ],
    })
  })

  it('cancel (null path) reads nothing and attaches nothing', async () => {
    vi.mocked(open).mockResolvedValue(null)
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    expect(invoke).not.toHaveBeenCalled()
    expect(attachments).toEqual([])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('reads a single path via read_file_as_base64 and builds a data-url attachment', async () => {
    vi.mocked(open).mockResolvedValue('/home/u/pic.png')
    vi.mocked(invoke).mockResolvedValue(BYTES_B64)
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    expect(invoke).toHaveBeenCalledWith('read_file_as_base64', { path: '/home/u/pic.png' })
    expect(attachments).toHaveLength(1)
    const [attachment] = attachments
    expect(attachment.type).toBe('image')
    expect(attachment.name).toBe('pic.png')
    expect(attachment.mimeType).toBe('image/png')
    expect(attachment.base64).toBe(`data:image/png;base64,${BYTES_B64}`)
    expect(attachment.size).toBe(3)
    expect(attachment.id).toMatch(/^image-\d+-[a-z0-9]+$/)
  })

  it('maps extension to mime: jpg → image/jpeg, webp → image/webp', async () => {
    vi.mocked(open).mockResolvedValue(['/a/x.jpg', '/a/y.webp'])
    vi.mocked(invoke).mockResolvedValue(BYTES_B64)
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    expect(attachments.map((a) => a.mimeType)).toEqual(['image/jpeg', 'image/webp'])
  })

  it('unknown extensions fall back to image/png (dialog filter is the only gate)', async () => {
    vi.mocked(open).mockResolvedValue('/a/photo.xyz')
    vi.mocked(invoke).mockResolvedValue(BYTES_B64)
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    expect(attachments[0].mimeType).toBe('image/png')
  })

  it('trailing-slash path keeps the whole path as the name (fallback chain quirk)', async () => {
    // '/home/u/'.split('/').pop() is '' (falsy), so the || chain falls to
    // split('\\').pop(), which returns the whole path. The 'image' literal
    // only fires for an empty string path, which the dialog never yields.
    vi.mocked(open).mockResolvedValue('/home/u/')
    vi.mocked(invoke).mockResolvedValue(BYTES_B64)
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    expect(attachments[0].name).toBe('/home/u/')
  })

  it('processes multiple paths in order', async () => {
    vi.mocked(open).mockResolvedValue(['/a/one.png', '/b/two.gif'])
    vi.mocked(invoke).mockResolvedValue(BYTES_B64)
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    expect(attachments.map((a) => a.name)).toEqual(['one.png', 'two.gif'])
    expect(attachments.map((a) => a.mimeType)).toEqual(['image/png', 'image/gif'])
  })

  it('a failed read aborts the remaining loop without a toast (logs only)', async () => {
    vi.mocked(open).mockResolvedValue(['/a/one.png', '/a/bad.png', '/a/three.png'])
    vi.mocked(invoke).mockImplementation(async (_cmd: string, args: unknown) => {
      const { path } = args as { path: string }
      if (path.endsWith('bad.png')) throw new Error('read failed')
      return BYTES_B64
    })
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    // First file was attached before the failure; second and third are gone:
    // the whole loop aborts into the outer catch (no per-file isolation here).
    expect(attachments.map((a) => a.name)).toEqual(['one.png'])
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('a dialog failure logs and attaches nothing', async () => {
    vi.mocked(open).mockRejectedValue(new Error('dialog crashed'))
    const { handleImageSelect } = renderSelect()

    await act(async () => handleImageSelect())

    expect(invoke).not.toHaveBeenCalled()
    expect(attachments).toEqual([])
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
