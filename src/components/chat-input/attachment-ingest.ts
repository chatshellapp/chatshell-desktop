// Shared attachment intake for the composer's entry points (file picker,
// image picker, drag-and-drop, paste): size gates, the image fit ladder,
// and rejection toasts that name every file and the next step.

import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import { invoke } from '@tauri-apps/api/core'
import {
  type Attachment,
  formatFileSize,
  getImageMimeType,
  getMimeType,
  isBinaryDocument,
} from './types'
import { isPdfFile } from './pdf-text'
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
  reason: 'unsupported' | 'tooLarge' | 'folder'
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
export function reportRejected(t: TFunction, rejectedFiles: RejectedFile[]): void {
  let rejected = rejectedFiles
  if (rejected.length === 0) return
  const folders = rejected.filter((file) => file.reason === 'folder')
  if (folders.length > 0) {
    // A dropped folder carries no path in the webview; the picker does.
    toast.info(t('folderDropUnsupported', { file: folders.map((f) => f.name).join(', ') }), {
      description: t('folderDropHint'),
    })
    rejected = rejected.filter((file) => file.reason !== 'folder')
    if (rejected.length === 0) return
  }
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

/**
 * Read a document at an absolute path (file picker, @-mention). Returns the
 * attachment, or the rejection when it is over the size limit. Read errors
 * throw.
 */
export async function readDocumentFromPath(
  t: TFunction,
  filePath: string,
  fileName: string
): Promise<Attachment | RejectedFile> {
  const size = await invoke<number>('get_path_file_size', { path: filePath })
  const tooLarge = checkSize(fileName, size, 'document')
  if (tooLarge) return tooLarge
  const mimeType = getMimeType(fileName)
  // Rust commands read the file (no plugin-fs scope). OOXML documents are
  // ZIP containers sent as base64 for the read tool; PDFs send their text
  // layer and keep their original bytes.
  const binary = isBinaryDocument(fileName)
  const pdf = isPdfFile(fileName, mimeType)
  const content = binary
    ? ''
    : await invoke<string>(pdf ? 'extract_pdf_text_from_path' : 'read_text_file_from_path', {
        path: filePath,
      })
  const base64 =
    binary || pdf ? await invoke<string>('read_file_as_base64', { path: filePath }) : undefined
  if (pdf) notifyIfScanned(t, fileName, content)
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'file',
    name: fileName,
    content,
    base64,
    mimeType,
    size: base64 ? Math.floor((base64.length * 3) / 4) : content.length,
  }
}

/** Read an image at an absolute path, fitted to provider limits. */
export async function readImageFromPath(
  filePath: string,
  fileName: string
): Promise<Attachment | RejectedFile> {
  const size = await invoke<number>('get_path_file_size', { path: filePath })
  const tooLarge = checkSize(fileName, size, 'image')
  if (tooLarge) return tooLarge
  const base64 = await invoke<string>('read_file_as_base64', { path: filePath })
  return imageAttachment(fileName, base64ToBytes(base64), getImageMimeType(fileName))
}

export function isRejected(result: Attachment | RejectedFile): result is RejectedFile {
  return 'reason' in result
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
