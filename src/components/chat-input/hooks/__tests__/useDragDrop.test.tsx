import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DragEvent } from 'react'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { useDragDrop } from '../useDragDrop'
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

function dragEvent(files: File[], types: string[] = ['Files']) {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { files, types },
  } as unknown as DragEvent
}

describe('useDragDrop', () => {
  let attachments: Attachment[]
  let setAttachments: (update: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isPdfFile).mockReturnValue(false)
    attachments = []
    setAttachments = (update) => {
      attachments = typeof update === 'function' ? update(attachments) : update
    }
  })

  function renderDrop(visionDisabled = false) {
    return renderHook(() => useDragDrop(setAttachments, visionDisabled)).result.current
  }

  describe('drag overlay state', () => {
    it('tracks nested drag enter/leave and hides the overlay on the final leave', () => {
      const { result } = renderHook(() => useDragDrop(setAttachments, false))

      act(() => result.current.dragHandlers.onDragEnter(dragEvent([])))
      expect(result.current.isDraggingOver).toBe(true)

      // A nested drag enters before the outer one leaves; the counter keeps
      // the overlay up until the last leave
      act(() => result.current.dragHandlers.onDragEnter(dragEvent([])))
      act(() => result.current.dragHandlers.onDragLeave(dragEvent([])))
      expect(result.current.isDraggingOver).toBe(true)

      act(() => result.current.dragHandlers.onDragLeave(dragEvent([])))
      expect(result.current.isDraggingOver).toBe(false)
    })

    it('ignores drags that carry no files', () => {
      const { result } = renderHook(() => useDragDrop(setAttachments, false))

      act(() => result.current.dragHandlers.onDragEnter(dragEvent([], ['text/plain'])))

      expect(result.current.isDraggingOver).toBe(false)
    })

    it('hides the overlay on drop', async () => {
      const { result } = renderHook(() => useDragDrop(setAttachments, false))
      act(() => result.current.dragHandlers.onDragEnter(dragEvent([])))

      await act(async () => {
        await result.current.dragHandlers.onDrop(
          dragEvent([makeFile('notes', 'notes.txt', 'text/plain')])
        )
      })

      expect(result.current.isDraggingOver).toBe(false)
    })

    it('prevents default on enter, over and leave', () => {
      const { result } = renderHook(() => useDragDrop(setAttachments, false))
      const enter = dragEvent([])
      const over = dragEvent([])
      const leave = dragEvent([])

      act(() => result.current.dragHandlers.onDragEnter(enter))
      act(() => result.current.dragHandlers.onDragOver(over))
      act(() => result.current.dragHandlers.onDragLeave(leave))

      for (const event of [enter, over, leave]) {
        expect(event.preventDefault).toHaveBeenCalledTimes(1)
        expect(event.stopPropagation).toHaveBeenCalledTimes(1)
      }
    })
  })

  describe('drop categorization', () => {
    it('adds a text document from its file content', async () => {
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([makeFile('hello', 'notes.txt', 'text/plain')]))
      })

      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        type: 'file',
        name: 'notes.txt',
        content: 'hello',
        mimeType: 'text/plain',
      })
    })

    it('adds an image with its data-url base64', async () => {
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([bytes('shot.png', 'image/png')]))
      })

      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        type: 'image',
        name: 'shot.png',
        mimeType: 'image/png',
        base64: `data:image/png;base64,${BYTES_B64}`,
      })
    })

    it('extracts pdf text on drop', async () => {
      vi.mocked(isPdfFile).mockReturnValue(true)
      vi.mocked(extractPdfTextFromFile).mockResolvedValue('pdf text')
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([makeFile('x', 'doc.pdf', 'application/pdf')]))
      })

      expect(attachments[0]).toMatchObject({ type: 'file', content: 'pdf text' })
    })

    it('keeps binary office documents as base64', async () => {
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([bytes('report.docx')]))
      })

      expect(attachments[0]).toMatchObject({ type: 'file', content: '', base64: BYTES_B64 })
    })

    it('toasts the offending extension for a single unsupported file', async () => {
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([makeFile('', 'archive.zip')]))
      })

      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(attachments).toEqual([])
    })

    it('toasts a count for several unsupported files', async () => {
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([makeFile('', 'a.zip'), makeFile('', 'b.exe')]))
      })

      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(attachments).toEqual([])
    })

    it('skips images entirely when the model has no vision', async () => {
      const { dragHandlers } = renderDrop(true)

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([bytes('shot.png', 'image/png')]))
      })

      expect(toast.warning).toHaveBeenCalledTimes(1)
      expect(attachments).toEqual([])
    })

    it('does nothing for an empty drop', async () => {
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([]))
      })

      expect(attachments).toEqual([])
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('processes every supported file from a mixed batch', async () => {
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(
          dragEvent([
            makeFile('notes', 'notes.txt', 'text/plain'),
            bytes('shot.png', 'image/png'),
            makeFile('', 'archive.zip'),
          ])
        )
      })

      expect(attachments.map((a) => a.type)).toEqual(['file', 'image'])
      expect(toast.error).toHaveBeenCalledTimes(1)
    })

    it('keeps processing after one file fails to read', async () => {
      const broken = makeFile('x', 'broken.txt', 'text/plain')
      Object.defineProperty(broken, 'text', {
        value: () => Promise.reject(new Error('read failed')),
      })
      const { dragHandlers } = renderDrop()

      await act(async () => {
        await dragHandlers.onDrop(dragEvent([broken, makeFile('ok', 'ok.txt', 'text/plain')]))
      })

      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(attachments).toHaveLength(1)
      expect(attachments[0].name).toBe('ok.txt')
    })
  })
})
