import { invoke } from '@tauri-apps/api/core'

/** Whether a file name or MIME type denotes a PDF. */
export function isPdfFile(fileName: string, mimeType?: string): boolean {
  return mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')
}

/** Extract the text layer from a PDF supplied by drag-and-drop or paste. */
export async function extractPdfTextFromFile(file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file)
  const separator = dataUrl.indexOf(',')
  if (separator === -1) {
    throw new Error('Failed to read PDF as a data URL')
  }
  return invoke<string>('extract_pdf_text_from_base64', {
    base64: dataUrl.slice(separator + 1),
  })
}

function readAsDataUrl(file: File): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result)
    } else {
      reject(new Error('Failed to read PDF as a data URL'))
    }
  }
  reader.onerror = () => reject(reader.error ?? new Error('Failed to read PDF'))
  reader.readAsDataURL(file)
  return promise
}
