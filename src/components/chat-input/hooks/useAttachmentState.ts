import { useState, useCallback } from 'react'
import { type Attachment, type AttachmentType } from '../types'

export interface UseAttachmentStateReturn {
  attachments: Attachment[]
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  addAttachment: (type: AttachmentType, name: string) => void
  removeAttachment: (id: string) => void
  clearAttachments: () => void
}

export function useAttachmentState(): UseAttachmentStateReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([])

  const addAttachment = useCallback((type: AttachmentType, name: string) => {
    const newAttachment: Attachment = {
      id: `${type}-${Date.now()}`,
      type,
      name,
    }
    setAttachments((prev) => [...prev, newAttachment])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id))
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments([])
  }, [])

  return {
    attachments,
    setAttachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
  }
}

