// ==========================================================================
// CATEGORY 1: USER ATTACHMENTS (user-provided files and links)
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

// User link - stores URL explicitly shared by user (not from search)
export interface UserLink {
  id: string
  url: string
  title?: string
  created_at: string
}

export interface CreateUserLinkRequest {
  url: string
  title?: string
}

// User attachment type enum
export type UserAttachmentType = 'file' | 'user_link'

// Unified user attachment type
export type UserAttachment =
  | ({ type: 'file' } & FileAttachment)
  | ({ type: 'user_link' } & UserLink)

// Helper type guards for user attachments
export function isFileAttachment(
  attachment: UserAttachment
): attachment is { type: 'file' } & FileAttachment {
  return attachment.type === 'file'
}

export function isUserLink(
  attachment: UserAttachment
): attachment is { type: 'user_link' } & UserLink {
  return attachment.type === 'user_link'
}

