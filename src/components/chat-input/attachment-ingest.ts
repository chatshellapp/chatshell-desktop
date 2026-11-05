// Shared attachment intake for the composer's entry points (file picker,
// image picker, drag-and-drop, paste): size gates, the image fit ladder,
// and rejection toasts that name every file and the next step.

import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import { type Attachment, formatFileSize, isBinaryDocument } from './types'
import { fitImage } from '@/lib/image-fit'

/** Text files are inlined or read as text; larger ones belong on disk. */
export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024
/** Office documents, PDFs, and images (before fitting). */
export const MAX_BINARY_FILE_BYTES = 50 * 1024 * 1024

export function sizeLimitFor(fileName: string, kind: 'document' | 'image'): number {
  if (kind === 'image') return MAX_BINARY_FILE_BYTES
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return isBinaryDocument(fileName) || ext === 'pdf' ? MAX_BINARY_FILE_BYTES : MAX_TEXT_FILE_BYTES
}

export interface RejectedFile {
  name: string
  reason: 'unsupported' | 'tooLarge'
  size?: number
  limit?: number
}

/** A rejection when `size` exceeds the limit for this file, else null. */
export function checkSize(
  name: string,
  size: number,
  kind: 'document' | 'image'
): RejectedFile | null {
  const limit = sizeLimitFor(name, kind)
  return size > limit ? { name, reason: 'tooLarge', size, limit } : null
}

/** One toast for a batch of rejected files: names plus the next step. */
export function reportRejected(t: TFunction, rejected: RejectedFile[]): void {
  if (rejected.length === 0) return
  if (rejected.length === 1) {
    const [file] = rejected
    if (file.reason === 'tooLarge') {
      toast.error(
        t('fileTooLarge', {
          file: file.name,
          size: formatFileSize(file.size ?? 0),
          limit: formatFileSize(file.limit ?? 0),
        }),
        { description: t('fileTooLargeHint') }
      )
    } else {
      toast.error(t('unsupportedFileFormat', { file: file.name }), {
        description: `${t('supportedFormats')} ${t('unsupportedFileHint')}`,
      })
    }
    return
  }
  const names = rejected.map((file) => file.name)
  toast.error(t('unsupportedFilesCount', { count: rejected.length }), {
    description: `${t('includingFiles', {
      files: names.slice(0, 3).join(', '),
      more: names.length > 3 ? '...' : '',
    })} ${t('unsupportedFileHint')}`,
  })
}

/** Mirrors the backend's MIN_TEXT_LAYER_CHARS (message_builder.rs). */
const MIN_TEXT_LAYER_CHARS = 50

/** Tell the user a PDF has no text layer: the assistant will look at page images. */
export function notifyIfScanned(t: TFunction, fileName: string, text: string): void {
  if (text.replace(/\s/g, '').length < MIN_TEXT_LAYER_CHARS) {
    toast.info(t('pdfScanned', { file: fileName }), { description: t('pdfScannedHint') })
  }
}

/** Build an image attachment from raw bytes, fitted to provider limits. */
export async function imageAttachment(
  name: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<Attachment> {
  const fitted = await fitImage(bytes, mimeType)
  return {
    id: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'image',
    name,
    base64: fitted.dataUrl,
    mimeType: fitted.mimeType,
    size: fitted.size,
  }
}

/** Decode standard base64 (no data URL prefix) to bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
