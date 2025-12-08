import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { type Attachment, getImageMimeType, SUPPORTED_IMAGE_EXTENSIONS } from '../types'
import { logger } from '@/lib/logger'

export interface UseImageSelectReturn {
  handleImageSelect: () => Promise<void>
}

export function useImageSelect(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
): UseImageSelectReturn {
  const handleImageSelect = useCallback(async () => {
    try {
      logger.info('[handleImageSelect] Opening file dialog...')
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Images',
            extensions: SUPPORTED_IMAGE_EXTENSIONS,
          },
        ],
      })

      logger.info('[handleImageSelect] Dialog result:', selected)

      if (!selected) {
        logger.info('[handleImageSelect] No file selected')
        return
      }

      const files = Array.isArray(selected) ? selected : [selected]
      logger.info('[handleImageSelect] Files to process:', files)

      for (const filePath of files) {
        logger.info('[handleImageSelect] Reading file:', filePath)
        // Use Rust command to read file as base64 (avoids plugin-fs scope issues)
        const base64 = await invoke<string>('read_file_as_base64', { path: filePath })
        logger.info('[handleImageSelect] Base64 length:', base64.length)

        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'image'
        const mimeType = getImageMimeType(fileName)

        // Estimate original file size from base64 length
        const estimatedSize = Math.floor((base64.length * 3) / 4)

        const newAttachment: Attachment = {
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'image',
          name: fileName,
          base64: `data:${mimeType};base64,${base64}`,
          mimeType,
          size: estimatedSize,
        }
        logger.info('[handleImageSelect] Created attachment', {
          name: newAttachment.name,
          size: newAttachment.size,
        })
        setAttachments((prev) => {
          logger.info('[handleImageSelect] Updating attachments, prev count:', prev.length)
          return [...prev, newAttachment]
        })
      }
      logger.info('[handleImageSelect] Done processing files')
    } catch (error) {
      logger.error('[handleImageSelect] Failed to select image:', error)
    }
  }, [setAttachments])

  return { handleImageSelect }
}
