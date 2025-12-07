// Main component
export { ChatInput } from './ChatInput'

// Sub-components
export { ModelSelectorDropdown } from './ModelSelectorDropdown'
export { AttachmentPreviewRow } from './AttachmentPreviewRow'
export { WebPageDialog } from './WebPageDialog'

// Hooks
export { useAttachments, type UseAttachmentsReturn } from './useAttachments'

// Types and utilities
export {
  type Attachment,
  type AttachmentType,
  getMimeType,
  getImageMimeType,
  formatFileSize,
  getFileType,
  getAttachmentIcon,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  URL_REGEX,
} from './types'

