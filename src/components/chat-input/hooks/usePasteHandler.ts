import { useCallback } from 'react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { type Attachment, getMimeType, getImageMimeType, getFileType, URL_REGEX } from '../types'

export interface UsePasteHandlerReturn {
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void>
}

export function usePasteHandler(
  attachments: Attachment[],
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
): UsePasteHandlerReturn {
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardData = e.clipboardData
      const files = Array.from(clipboardData.files)

      // Handle file paste (documents and images from clipboard)
      if (files.length > 0) {
        e.preventDefault() // Prevent default text paste when handling files

        const unsupportedFiles: string[] = []
        const documentsToProcess: File[] = []
        const imagesToProcess: File[] = []

        // Categorize files
        for (const file of files) {
          // For clipboard images without extension (e.g., screenshots), check mime type
          if (file.type.startsWith('image/')) {
            imagesToProcess.push(file)
          } else {
            const fileType = getFileType(file.name)
            if (fileType === 'document') {
              documentsToProcess.push(file)
            } else if (fileType === 'image') {
              imagesToProcess.push(file)
            } else {
              unsupportedFiles.push(file.name || file.type)
            }
          }
        }

        // Show error for unsupported files
        if (unsupportedFiles.length > 0) {
          const fileDesc = unsupportedFiles[0]
          if (unsupportedFiles.length === 1) {
            toast.error(`Unsupported file format: ${fileDesc}`, {
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
            logger.error('Failed to read pasted file:', file.name, error)
            toast.error(`Failed to read: ${file.name}`)
          }
        }

        // Process images
        for (const file of imagesToProcess) {
          try {
            const arrayBuffer = await file.arrayBuffer()
            const base64 = btoa(
              new Uint8Array(arrayBuffer).reduce(
                (data, byte) => data + String.fromCharCode(byte),
                ''
              )
            )

            // Generate filename for clipboard images without name
            let fileName = file.name
            if (!fileName || fileName === 'image.png' || fileName === 'blob') {
              const ext = file.type.split('/')[1] || 'png'
              fileName = `clipboard-${Date.now()}.${ext}`
            }

            const mimeType = file.type || getImageMimeType(fileName)

            const newAttachment: Attachment = {
              id: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              type: 'image',
              name: fileName,
              base64: `data:${mimeType};base64,${base64}`,
              mimeType,
              size: file.size,
            }
            setAttachments((prev) => [...prev, newAttachment])
          } catch (error) {
            logger.error('Failed to read pasted image:', file.name, error)
            toast.error(`Failed to read image: ${file.name || 'clipboard image'}`)
          }
        }

        return // Don't process as text if we handled files
      }

      // Handle text paste (URL detection)
      const pastedText = clipboardData.getData('text')
      const urls = pastedText.match(URL_REGEX)

      if (urls && urls.length > 0) {
        const newAttachments: Attachment[] = []
        urls.forEach((url) => {
          const isDuplicate =
            attachments.some((att) => att.type === 'webpage' && att.name === url) ||
            newAttachments.some((att) => att.name === url)

          if (!isDuplicate) {
            newAttachments.push({
              id: `webpage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              type: 'webpage',
              name: url,
            })
          }
        })

        if (newAttachments.length > 0) {
          setAttachments((prev) => [...prev, ...newAttachments])
        }
      }
    },
    [attachments, setAttachments]
  )

  return { handlePaste }
}
