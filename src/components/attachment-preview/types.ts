import type {
  UserAttachment,
  ContextEnrichment,
  ProcessStep,
} from '@/types'

/** Image data for lightbox navigation - supports both storage paths and base64 data */
export interface ImageAttachmentData {
  id: string
  fileName: string
  /** Storage path for persisted images (loaded via Tauri) */
  storagePath?: string
  /** Base64 data URL for in-memory images (e.g., data:image/png;base64,...) */
  base64?: string
}

export interface AttachmentPreviewProps {
  /** User attachment (files, user links) */
  userAttachment?: UserAttachment
  /** Context enrichment (search results, fetch results) */
  context?: ContextEnrichment
  /** Process step (thinking, search decision, tool call, code execution) */
  step?: ProcessStep
  /** URL being processed (for loading state) */
  processingUrl?: string
  /** URL fetch statuses for search results: { url: 'fetching' | 'fetched' } */
  urlStatuses?: Record<string, 'fetching' | 'fetched'>
  /** Message ID - used to query fetch results via message_contexts (for deduplication support) */
  messageId?: string
  /** Show pending search decision state (AI is deciding if search is needed) */
  pendingSearchDecision?: boolean
  /** All image attachments for lightbox navigation (only used when attachment is an image) */
  allImages?: ImageAttachmentData[]
  /** Current image index in allImages array */
  currentImageIndex?: number
}

/** Props for FilePreviewDialog - supports both storage paths and in-memory content */
export interface FilePreviewDialogProps {
  isOpen: boolean
  onClose: () => void
  fileName: string
  /** In-memory content (used directly if provided) */
  content?: string
  /** Storage path (loads content via Tauri if content not provided) */
  storagePath?: string
  mimeType?: string
  size?: number
}

