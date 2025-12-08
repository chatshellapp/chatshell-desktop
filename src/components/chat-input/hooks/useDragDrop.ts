import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { type Attachment, getMimeType, getImageMimeType, getFileType } from '../types'
import { logger } from '@/lib/logger'

export interface DragHandlers {
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => Promise<void>
}

export interface UseDragDropReturn {
  isDraggingOver: boolean
  dragHandlers: DragHandlers
}

export function useDragDrop(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
): UseDragDropReturn {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDraggingOver(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return

      const unsupportedFiles: string[] = []
      const documentsToProcess: File[] = []
      const imagesToProcess: File[] = []

      // Categorize files
      for (const file of files) {
        const fileType = getFileType(file.name)
        if (fileType === 'document') {
          documentsToProcess.push(file)
        } else if (fileType === 'image') {
          imagesToProcess.push(file)
        } else {
          unsupportedFiles.push(file.name)
        }
      }

      // Show error for unsupported files
      if (unsupportedFiles.length > 0) {
        const ext = unsupportedFiles[0].split('.').pop()?.toLowerCase() || 'unknown'
        if (unsupportedFiles.length === 1) {
          toast.error(`Unsupported file format: .${ext}`, {
            description:
              'Supported: documents (.md, .txt, .json, .js, .ts, etc.) and images (.png, .jpg, .gif, .webp)',
          })
        } else {
          toast.error(`${unsupportedFiles.length} unsupported files`, {
            description: `Including: ${unsupportedFiles.slice(0, 3).join(', ')}${unsupportedFiles.length > 3 ? '...' : ''}`,
          })
        }
      }

      // Process documents
      for (const file of documentsToProcess) {
        try {
          const content = await file.text()
          const newAttachment: Attachment = {
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'file',
            name: file.name,
            content,
            mimeType: getMimeType(file.name),
            size: content.length,
          }
          setAttachments((prev) => [...prev, newAttachment])
        } catch (error) {
          logger.error(`Failed to read file: ${file.name}`, error)
          toast.error(`Failed to read: ${file.name}`)
        }
      }

      // Process images
      for (const file of imagesToProcess) {
        try {
          const arrayBuffer = await file.arrayBuffer()
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          )
          const mimeType = getImageMimeType(file.name)

          const newAttachment: Attachment = {
            id: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'image',
            name: file.name,
            base64: `data:${mimeType};base64,${base64}`,
            mimeType,
            size: file.size,
          }
          setAttachments((prev) => [...prev, newAttachment])
        } catch (error) {
          logger.error(`Failed to read image: ${file.name}`, error)
          toast.error(`Failed to read image: ${file.name}`)
        }
      }
    },
    [setAttachments]
  )

  return {
    isDraggingOver,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  }
}
