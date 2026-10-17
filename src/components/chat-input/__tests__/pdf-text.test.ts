import { describe, expect, it } from 'vitest'
import { getFileType, getMimeType } from '../types'
import { isPdfFile } from '../pdf-text'

describe('PDF attachments', () => {
  it('classifies PDFs as documents with the PDF media type', () => {
    expect(getFileType('report.pdf')).toBe('document')
    expect(getFileType('REPORT.PDF')).toBe('document')
    expect(getMimeType('report.pdf')).toBe('application/pdf')
  })

  it('recognizes PDFs by name or by MIME type', () => {
    expect(isPdfFile('report.pdf')).toBe(true)
    expect(isPdfFile('REPORT.PDF')).toBe(true)
    expect(isPdfFile('attachment', 'application/pdf')).toBe(true)
    expect(isPdfFile('report.txt')).toBe(false)
  })
})
