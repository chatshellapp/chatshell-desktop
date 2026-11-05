import { useCallback } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { logger } from '@/lib/logger'
import {
  type Attachment,
  getMimeType,
  getImageMimeType,
  getFileType,
  isBinaryDocument,
  readFileAsBase64,
} from '../types'
import { extractPdfTextFromFile, isPdfFile } from '../pdf-text'
import { checkSize, imageAttachment, reportRejected, type RejectedFile } from '../attachment-ingest'

export interface UsePasteHandlerReturn {
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void>
}

export function usePasteHandler(
  attachments: Attachment[],
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>,
  visionDisabled: boolean
): UsePasteHandlerReturn {
  const { t } = useTranslation('messages')
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardData = e.clipboardData
      const files = Array.from(clipboardData.files)

      // Handle file paste (documents and images from clipboard)
      if (files.length > 0) {
        e.preventDefault() // Prevent default text paste when handling files

        const rejected: RejectedFile[] = []
        const documentsToProcess: File[] = []
        const imagesToProcess: File[] = []

        // Categorize files
        for (const file of files) {
          // For clipboard images without extension (e.g., screenshots), check mime type
          const fileType = file.type.startsWith('image/')
            ? 'image'
            : file.type === 'application/pdf'
              ? 'document'
              : getFileType(file.name)
          if (fileType === 'unsupported') {
            rejected.push({ name: file.name || file.type, reason: 'unsupported' })
            continue
          }
          const tooLarge = checkSize(file.name || file.type, file.size, fileType)
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
          const fileName =
            file.name ||
            (file.type === 'application/pdf'
              ? `clipboard-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
              : 'file')
          try {
            const mimeType = getMimeType(fileName)
            const binary = isBinaryDocument(fileName)
            const content = binary
              ? ''
              : isPdfFile(fileName, mimeType)
                ? await extractPdfTextFromFile(file)
                : await file.text()
            const base64 = binary ? await readFileAsBase64(file) : undefined
            const newAttachment: Attachment = {
              id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              type: 'file',
              name: fileName,
              content,
              base64,
              mimeType,
              size: file.size,
            }
            setAttachments((prev) => [...prev, newAttachment])
          } catch (error) {
            logger.error(`Failed to read pasted file: ${fileName}`, error)
            toast.error(t('failedToReadFile', { file: fileName }), {
              description: error instanceof Error ? error.message : String(error),
            })
          }
        }

        // Process images
        for (const file of imagesToProcess) {
          try {
            const bytes = new Uint8Array(await file.arrayBuffer())

            // Generate filename for clipboard images without name
            let fileName = file.name
            if (!fileName || fileName === 'image.png' || fileName === 'blob') {
              const ext = file.type.split('/')[1] || 'png'
              fileName = `clipboard-${Date.now()}.${ext}`
            }

            const mimeType = file.type || getImageMimeType(fileName)

            const newAttachment = await imageAttachment(fileName, bytes, mimeType)
            setAttachments((prev) => [...prev, newAttachment])
          } catch (error) {
            logger.error(`Failed to read pasted image: ${file.name}`, error)
            toast.error(t('failedToReadImage', { file: file.name || t('clipboardImage') }))
          }
        }

        return // Don't process as text if we handled files
      }
    },
    [attachments, setAttachments, visionDisabled, t]
  )

  return { handlePaste }
}
