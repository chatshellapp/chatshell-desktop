// OOXML documents are ZIP containers: they must never be decoded as
// UTF-8. They travel as base64 and are read through the read tool or the
// office text extractor (extract_office_text_* commands).
export const BINARY_DOCUMENT_EXTENSIONS = ['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm']

// Videos travel as base64 bytes too: the read tool shows the model a
// contact sheet through ffmpeg, never the bytes.
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']

export function isVideoFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return VIDEO_EXTENSIONS.includes(ext)
}

export function isBinaryDocument(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return BINARY_DOCUMENT_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext)
}
