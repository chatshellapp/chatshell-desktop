import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ClipboardEvent } from 'react'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { usePasteHandler } from '../usePasteHandler'
import { extractPdfTextFromFile, isPdfFile } from '../../pdf-text'
import type { Attachment } from '../../types'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// pdfjs is heavy machinery; the branch logic under test only needs to know
// whether a file is a pdf and what text comes back
vi.mock('../../pdf-text', () => ({
  extractPdfTextFromFile: vi.fn(),
  isPdfFile: vi.fn(() => false),
}))

// Initialize i18n so useTranslation('messages') resolves real copy
void i18n

// jsdom's File may lack text()/arrayBuffer(); build files whose read methods
// always work, backed by the known source content.
function makeFile(content: string | Uint8Array, name: string, mimeType = ''): File {
  const file = new File([content], name, { type: mimeType })
  const asText = () => (typeof content === 'string' ? content : new TextDecoder().decode(content))
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: async () => asText(), configurable: true })
  }
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(asText()).buffer as ArrayBuffer,
      configurable: true,
    })
  }
  return file
}

// Base64 of bytes [0, 1, 2]
const BYTES_B64 = 'AAEC'

const bytes = (name: string, mimeType = '') => makeFile(new Uint8Array([0, 1, 2]), name, mimeType)

describe('usePasteHandler', () => {
  let attachments: Attachment[]
  let setAttachments: (update: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void
  let preventDefault: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isPdfFile).mockReturnValue(false)
    attachments = []
    setAttachments = (update) => {
      attachments = typeof update === 'function' ? update(attachments) : update
    }
  })

  async function paste(files: File[], visionDisabled = false) {
    const { result } = renderHook(() =>
      usePasteHandler(attachments, setAttachments, visionDisabled)
    )
    const event = {
      preventDefault: vi.fn(),
      clipboardData: { files },
    } as unknown as ClipboardEvent<HTMLTextAreaElement>
    preventDefault = event.preventDefault as ReturnType<typeof vi.fn>
    await act(async () => {
      await result.current.handlePaste(event)
    })
  }

  it('ignores a text-only paste', async () => {
    await paste([])

    expect(preventDefault).not.toHaveBeenCalled()
    expect(attachments).toEqual([])
  })

  it('keeps a clipboard screenshot as an image attachment with a generated name', async () => {
    await paste([bytes('', 'image/png')])

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      base64: `data:image/png;base64,${BYTES_B64}`,
    })
    expect(attachments[0].name).toMatch(/^clipboard-\d+\.png$/)
  })

  it('renames generic clipboard names like blob and image.png', async () => {
    await paste([bytes('blob', 'image/jpeg'), bytes('image.png', 'image/png')])

    expect(attachments.map((a) => a.name)).toEqual([
      expect.stringMatching(/^clipboard-\d+\.jpeg$/),
      expect.stringMatching(/^clipboard-\d+\.png$/),
    ])
  })

  it('classifies an image by extension when the clipboard type is empty', async () => {
    await paste([makeFile(new Uint8Array([9]), 'photo.jpg')])

    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      type: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
    })
  })

  it('skips pasted images when the selected model has no vision', async () => {
    await paste([bytes('shot.png', 'image/png')], true)

    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(attachments).toEqual([])
  })

  it('reads a text document into its attachment content', async () => {
    await paste([makeFile('hello world', 'notes.txt', 'text/plain')])

    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      type: 'file',
      name: 'notes.txt',
      content: 'hello world',
      mimeType: 'text/plain',
    })
    expect(attachments[0].base64).toBeUndefined()
  })

  it('extracts pdf text instead of raw bytes', async () => {
    vi.mocked(isPdfFile).mockReturnValue(true)
    vi.mocked(extractPdfTextFromFile).mockResolvedValue('extracted pdf text')
    const pdf = bytes('doc.pdf', 'application/pdf')

    await paste([pdf])

    expect(extractPdfTextFromFile).toHaveBeenCalledWith(pdf)
    expect(attachments[0]).toMatchObject({
      type: 'file',
      name: 'doc.pdf',
      content: 'extracted pdf text',
      mimeType: 'application/pdf',
    })
  })

  it('names an unnamed clipboard pdf', async () => {
    vi.mocked(isPdfFile).mockReturnValue(true)
    vi.mocked(extractPdfTextFromFile).mockResolvedValue('pdf body')

    await paste([bytes('', 'application/pdf')])

    expect(attachments[0].name).toMatch(/^clipboard-\d+-[a-z0-9]+\.pdf$/)
    expect(attachments[0].content).toBe('pdf body')
  })

  it('keeps binary office documents as base64 without decoding', async () => {
    await paste([bytes('report.docx')])

    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      type: 'file',
      name: 'report.docx',
      content: '',
      base64: BYTES_B64,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
  })

  it('toasts once for a single unsupported format', async () => {
    await paste([makeFile('zip bytes', 'archive.zip', 'application/zip')])

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(attachments).toEqual([])
  })

  it('toasts a count for multiple unsupported formats', async () => {
    await paste([
      makeFile('', 'a.zip', 'application/zip'),
      makeFile('', 'b.exe', 'application/octet-stream'),
    ])

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(attachments).toEqual([])
  })

  it('continues past a file that fails to read', async () => {
    const broken = makeFile('x', 'broken.txt', 'text/plain')
    Object.defineProperty(broken, 'text', {
      value: () => Promise.reject(new Error('read failed')),
    })

    await paste([broken, makeFile('fine', 'good.txt', 'text/plain')])

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(attachments).toHaveLength(1)
    expect(attachments[0].name).toBe('good.txt')
  })

  it('toasts when a pasted image cannot be read', async () => {
    const broken = bytes('shot.png', 'image/png')
    Object.defineProperty(broken, 'arrayBuffer', {
      value: () => Promise.reject(new Error('arrayBuffer failed')),
    })

    await paste([broken])

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(attachments).toEqual([])
  })

  it('processes a mixed batch in one paste', async () => {
    await paste([
      bytes('shot.png', 'image/png'),
      makeFile('notes', 'notes.txt', 'text/plain'),
      makeFile('', 'archive.zip', 'application/zip'),
    ])

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(attachments.map((a) => a.type)).toEqual(['file', 'image'])
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
