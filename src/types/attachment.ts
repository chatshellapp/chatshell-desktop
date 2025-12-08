// ==========================================================================
// CATEGORY 1: USER ATTACHMENTS (user-provided files)
// ==========================================================================

// File attachment - stores user uploaded file metadata (content in filesystem)
export interface FileAttachment {
  id: string
  file_name: string
  file_size: number
  mime_type: string
  storage_path: string // Path relative to attachments dir: "files/{uuid}.pdf"
  created_at: string
}

export interface CreateFileAttachmentRequest {
  file_name: string
  file_size: number
  mime_type: string
  storage_path: string
}

// User attachment type enum (currently only files)
// User-provided URLs are stored as fetch_results with source_type="user_link"
export type UserAttachmentType = 'file'

// Unified user attachment type
export type UserAttachment = { type: 'file' } & FileAttachment

// Helper type guard for user attachments
export function isFileAttachment(
  attachment: UserAttachment
): attachment is { type: 'file' } & FileAttachment {
  return attachment.type === 'file'
}
