// Attachment types are generated from Rust models (src-tauri/src/models/attachment.rs)
// via ts-rs. Run `pnpm types:generate` in src-tauri to regenerate.

export type { FileAttachment } from './generated/FileAttachment'
export type { CreateFileAttachmentRequest } from './generated/CreateFileAttachmentRequest'
export type { UserAttachment } from './generated/UserAttachment'

import type { FileAttachment } from './generated/FileAttachment'
import type { UserAttachment } from './generated/UserAttachment'
// User attachment type enum (currently only files)
// User-provided URLs are stored as fetch_results with source_type="user_link"
export type UserAttachmentType = 'file'

// Helper type guard for user attachments
export function isFileAttachment(
  attachment: UserAttachment
): attachment is { type: 'file' } & FileAttachment {
  return attachment.type === 'file'
}
