import { type Attachment, type AttachmentType } from './types'
import {
  useAttachmentState,
  useFileSelect,
  useImageSelect,
  usePasteHandler,
  useDragDrop,
  type DragHandlers,
} from './hooks'

export interface UseAttachmentsReturn {
  attachments: Attachment[]
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  addAttachment: (type: AttachmentType, name: string) => void
  removeAttachment: (id: string) => void
  clearAttachments: () => void
  handleFileSelect: () => Promise<void>
  handleImageSelect: () => Promise<void>
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void>
  // Drag and drop
  isDraggingOver: boolean
  dragHandlers: DragHandlers
}

/**
 * Composite hook that manages all attachment-related functionality.
 * Combines state management, file selection, image selection, paste handling, and drag-and-drop.
 */
export function useAttachments(): UseAttachmentsReturn {
  // Core state management
  const { attachments, setAttachments, addAttachment, removeAttachment, clearAttachments } =
    useAttachmentState()

  // File selection via native dialog
  const { handleFileSelect } = useFileSelect(setAttachments)

  // Image selection via native dialog
  const { handleImageSelect } = useImageSelect(setAttachments)

  // Clipboard paste handling
  const { handlePaste } = usePasteHandler(attachments, setAttachments)

  // Drag and drop functionality
  const { isDraggingOver, dragHandlers } = useDragDrop(setAttachments)

  return {
    attachments,
    setAttachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    handleFileSelect,
    handleImageSelect,
    handlePaste,
    isDraggingOver,
    dragHandlers,
  }
}
