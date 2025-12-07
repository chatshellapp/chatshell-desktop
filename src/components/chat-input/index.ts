// Main component
export { ChatInput } from './ChatInput'

// Sub-components
export { ModelSelectorDropdown } from './ModelSelectorDropdown'
export { AttachmentPreviewRow } from './AttachmentPreviewRow'
export { WebPageDialog } from './WebPageDialog'
export { DropZoneOverlay } from './DropZoneOverlay'
export { InputToolbar } from './InputToolbar'

// Hooks
export { useAttachments, type UseAttachmentsReturn } from './useAttachments'
export { useKeyboardHandlers } from './useKeyboardHandlers'
export { useSubmitHandler } from './useSubmitHandler'

// Attachment sub-hooks (for granular usage)
export {
  useAttachmentState,
  useFileSelect,
  useImageSelect,
  usePasteHandler,
  useDragDrop,
  type UseAttachmentStateReturn,
  type UseFileSelectReturn,
  type UseImageSelectReturn,
  type UsePasteHandlerReturn,
  type UseDragDropReturn,
  type DragHandlers,
} from './hooks'

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
