import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { FileAttachmentPreview, FilePreviewDialog } from '../file-preview'
import type { FileAttachment } from '@/types'

const mockInvoke = vi.mocked(invoke)

function makeDocxAttachment(): FileAttachment {
  return {
    id: 'f-1',
    file_name: 'report.docx',
    file_size: 4,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    storage_path: 'files/hash.docx',
    content_hash: 'hash',
    created_at: '2026-10-19T00:00:00Z',
  }
}

describe('binary document preview', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('extracts stored OOXML attachments instead of reading them as UTF-8', async () => {
    mockInvoke.mockResolvedValue('# Report\n\nHello office preview')

    render(<FileAttachmentPreview fileAttachment={makeDocxAttachment()} />)
    fireEvent.click(screen.getByRole('button', { name: /report\.docx/ }))

    await waitFor(() => {
      expect(screen.getByText(/Hello office preview/)).toBeInTheDocument()
    })
    expect(mockInvoke).toHaveBeenCalledWith('extract_office_text_from_storage', {
      storagePath: 'files/hash.docx',
    })
    expect(mockInvoke).not.toHaveBeenCalledWith('read_file_content', expect.anything())
  })

  it('shows an explicit no-preview state when extraction fails', async () => {
    mockInvoke.mockRejectedValue(new Error('not a zip'))

    render(<FileAttachmentPreview fileAttachment={makeDocxAttachment()} />)
    fireEvent.click(screen.getByRole('button', { name: /report\.docx/ }))

    await waitFor(() => {
      expect(screen.getByText('No text preview for this document')).toBeInTheDocument()
    })
    expect(screen.queryByText('No content available')).not.toBeInTheDocument()
  })

  it('extracts in-memory bytes before the attachment is sent', async () => {
    mockInvoke.mockResolvedValue('Sheet1\nA\tB')

    render(
      <FilePreviewDialog
        isOpen={true}
        onClose={() => {}}
        fileName="sheet.xlsx"
        base64="QUJD"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        size={3}
      />
    )

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('extract_office_text_from_base64', {
        base64: 'QUJD',
        fileName: 'sheet.xlsx',
      })
    })
    await waitFor(() => {
      expect(screen.getByText(/Sheet1/)).toBeInTheDocument()
    })
  })
})
