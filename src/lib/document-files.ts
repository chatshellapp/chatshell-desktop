// OOXML documents are ZIP containers: they must never be decoded as
// UTF-8. They travel as base64 and are read through the read tool or the
// office text extractor (extract_office_text_* commands).
export const BINARY_DOCUMENT_EXTENSIONS = ['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm']

export function isBinaryDocument(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return BINARY_DOCUMENT_EXTENSIONS.includes(ext)
}
