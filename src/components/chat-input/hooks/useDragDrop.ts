import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  type Attachment,
  getMimeType,
  getImageMimeType,
  getFileType,
  isBinaryDocument,
  readFileAsBase64,
} from '../types'
import { extractPdfTextFromFile, isPdfFile } from '../pdf-text'
import {
  checkSize,
  imageAttachment,
  notifyIfScanned,
  reportRejected,
  type RejectedFile,
} from '../attachment-ingest'
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
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>,
  visionDisabled: boolean
): UseDragDropReturn {
  const { t } = useTranslation('messages')
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

      // Dropped folders surface as entries without a usable path.
      const folderNames = new Set(
        Array.from(e.dataTransfer.items ?? [])
          .map((item) => item.webkitGetAsEntry?.())
          .filter((entry) => entry?.isDirectory)
          .map((entry) => entry!.name)
      )

      const rejected: RejectedFile[] = []
      const documentsToProcess: File[] = []
      const imagesToProcess: File[] = []

      // Categorize files
      for (const file of files) {
        if (folderNames.has(file.name)) {
          rejected.push({ name: file.name, reason: 'folder' })
          continue
        }
        const fileType = getFileType(file.name)
        if (fileType === 'unsupported') {
          rejected.push({ name: file.name, reason: 'unsupported' })
          continue
        }
        const tooLarge = checkSize(file.name, file.size, fileType)
        if (tooLarge) {
          rejected.push(tooLarge)
        } else if (fileType === 'document') {
          documentsToProcess.push(file)
        } else {
          imagesToProcess.push(file)
        }
      }

      if (visionDisabled && imagesToProcess.length > 0) {
        toast.warning(t('imageNotSupportedByModel'), {
          description: t('imagesSkipped', { count: imagesToProcess.length }),
        })
        imagesToProcess.length = 0
      }

      reportRejected(t, rejected)

      // Process documents
      for (const file of documentsToProcess) {
        try {
          const mimeType = getMimeType(file.name)
          const binary = isBinaryDocument(file.name)
          const pdf = isPdfFile(file.name, mimeType)
          const content = binary ? '' : pdf ? await extractPdfTextFromFile(file) : await file.text()
          // PDFs keep their original bytes next to the text layer.
          const base64 = binary || pdf ? await readFileAsBase64(file) : undefined
          if (pdf) notifyIfScanned(t, file.name, content)
          const newAttachment: Attachment = {
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'file',
            name: file.name,
            content,
            base64,
            mimeType,
            size: file.size,
          }
          setAttachments((prev) => [...prev, newAttachment])
        } catch (error) {
          logger.error(`Failed to read file: ${file.name}`, error)
          toast.error(t('failedToReadFile', { file: file.name }), {
            description: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Process images
      for (const file of imagesToProcess) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const newAttachment = await imageAttachment(file.name, bytes, getImageMimeType(file.name))
          setAttachments((prev) => [...prev, newAttachment])
        } catch (error) {
          logger.error(`Failed to read image: ${file.name}`, error)
          toast.error(t('failedToReadImage', { file: file.name }))
        }
      }
    },
    [setAttachments, visionDisabled, t]
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
