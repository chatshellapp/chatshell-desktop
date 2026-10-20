import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { useFileSelect } from '../useFileSelect'
import { SUPPORTED_DOCUMENT_EXTENSIONS, type Attachment } from '../../types'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Initialize i18n so useTranslation('messages') resolves real copy
void i18n

// Base64 of bytes [0, 1, 2]: estimated size is floor(4 * 3 / 4) = 3
const BYTES_B64 = 'AAEC'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('useFileSelect', () => {
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
    return renderHook(() => useFileSelect(setAttachments)).result.current
  }

  it('opens a multi-select dialog filtered to supported documents', async () => {
    vi.mocked(open).mockResolvedValue(null)
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(open).toHaveBeenCalledWith({
      multiple: true,
      filters: [{ name: 'Documents', extensions: SUPPORTED_DOCUMENT_EXTENSIONS }],
    })
  })

  it('cancel (null path) reads nothing and attaches nothing', async () => {
    vi.mocked(open).mockResolvedValue(null)
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(invoke).not.toHaveBeenCalled()
    expect(attachments).toEqual([])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('text files read via read_text_file_from_path with content and no base64', async () => {
    vi.mocked(open).mockResolvedValue('/docs/notes.md')
    vi.mocked(invoke).mockResolvedValue('# hello')
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(invoke).toHaveBeenCalledWith('read_text_file_from_path', { path: '/docs/notes.md' })
    expect(attachments).toHaveLength(1)
    const [attachment] = attachments
    expect(attachment.type).toBe('file')
    expect(attachment.name).toBe('notes.md')
    expect(attachment.content).toBe('# hello')
    expect(attachment.base64).toBeUndefined()
    expect(attachment.mimeType).toBe('text/markdown')
    expect(attachment.size).toBe('# hello'.length)
    expect(attachment.id).toMatch(/^file-\d+-[a-z0-9]+$/)
  })

  it('pdfs are routed to extract_pdf_text_from_path', async () => {
    vi.mocked(open).mockResolvedValue('/docs/report.pdf')
    vi.mocked(invoke).mockResolvedValue('pdf text layer')
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(invoke).toHaveBeenCalledWith('extract_pdf_text_from_path', {
      path: '/docs/report.pdf',
    })
    expect(attachments[0]).toMatchObject({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      content: 'pdf text layer',
      size: 'pdf text layer'.length,
    })
  })

  it('ooxml documents are read as base64 with empty string content', async () => {
    vi.mocked(open).mockResolvedValue('/docs/sheet.xlsx')
    vi.mocked(invoke).mockResolvedValue(BYTES_B64)
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(invoke).toHaveBeenCalledWith('read_file_as_base64', { path: '/docs/sheet.xlsx' })
    expect(attachments[0]).toMatchObject({
      name: 'sheet.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: '',
      base64: BYTES_B64,
      size: 3,
    })
  })

  it('docx keeps its wordprocessing mime type on the base64 path', async () => {
    vi.mocked(open).mockResolvedValue('/docs/paper.docx')
    vi.mocked(invoke).mockResolvedValue(BYTES_B64)
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(attachments[0].mimeType).toBe(DOCX_MIME)
  })

  it('unknown extensions default to text/plain on the text path', async () => {
    vi.mocked(open).mockResolvedValue('/docs/data.zzz')
    vi.mocked(invoke).mockResolvedValue('raw text')
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(invoke).toHaveBeenCalledWith('read_text_file_from_path', { path: '/docs/data.zzz' })
    expect(attachments[0].mimeType).toBe('text/plain')
  })

  it('trailing-slash path keeps the whole path as the name (fallback chain quirk)', async () => {
    // Same quirk as the image picker: the 'file' literal fallback is
    // unreachable for dialog-returned paths; the whole path becomes the name.
    vi.mocked(open).mockResolvedValue('/docs/')
    vi.mocked(invoke).mockResolvedValue('x')
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(attachments[0].name).toBe('/docs/')
  })

  it('a failed read toasts per file and the loop continues with the rest', async () => {
    vi.mocked(open).mockResolvedValue(['/docs/bad.md', '/docs/good.md'])
    vi.mocked(invoke).mockRejectedValueOnce(new Error('boom'))
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(attachments.map((a) => a.name)).toEqual(['good.md'])
    expect(toast.error).toHaveBeenCalledWith('Failed to read: bad.md', { description: 'boom' })
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('non-Error rejections stringify into the toast description', async () => {
    vi.mocked(open).mockResolvedValue('/docs/bad.md')
    vi.mocked(invoke).mockRejectedValue('plain failure')
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(toast.error).toHaveBeenCalledWith('Failed to read: bad.md', {
      description: 'plain failure',
    })
    expect(attachments).toEqual([])
  })

  it('a dialog failure logs without a toast and attaches nothing', async () => {
    vi.mocked(open).mockRejectedValue(new Error('dialog crashed'))
    const { handleFileSelect } = renderSelect()

    await act(async () => handleFileSelect())

    expect(invoke).not.toHaveBeenCalled()
    expect(attachments).toEqual([])
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })
})
