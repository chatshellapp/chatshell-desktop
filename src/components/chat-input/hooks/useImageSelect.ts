import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { type Attachment, getImageMimeType, SUPPORTED_IMAGE_EXTENSIONS } from '../types'
import {
  base64ToBytes,
  checkSize,
  imageAttachment,
  reportRejected,
  type RejectedFile,
} from '../attachment-ingest'
import { logger } from '@/lib/logger'

export interface UseImageSelectReturn {
  handleImageSelect: () => Promise<void>
}

export function useImageSelect(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
): UseImageSelectReturn {
  const { t } = useTranslation('messages')
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

      const rejected: RejectedFile[] = []
      for (const filePath of files) {
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'image'
        const size = await invoke<number>('get_path_file_size', { path: filePath })
        const tooLarge = checkSize(fileName, size, 'image')
        if (tooLarge) {
          rejected.push(tooLarge)
          continue
        }
        logger.info('[handleImageSelect] Reading file:', filePath)
        // Use Rust command to read file as base64 (avoids plugin-fs scope issues)
        const base64 = await invoke<string>('read_file_as_base64', { path: filePath })
        logger.info('[handleImageSelect] Base64 length:', base64.length)

        const newAttachment: Attachment = await imageAttachment(
          fileName,
          base64ToBytes(base64),
          getImageMimeType(fileName)
        )
        logger.info('[handleImageSelect] Created attachment', {
          name: newAttachment.name,
          size: newAttachment.size,
        })
        setAttachments((prev) => {
          logger.info('[handleImageSelect] Updating attachments, prev count:', prev.length)
          return [...prev, newAttachment]
        })
      }
      reportRejected(t, rejected)
      logger.info('[handleImageSelect] Done processing files')
    } catch (error) {
      logger.error('[handleImageSelect] Failed to select image:', error)
    }
  }, [setAttachments, t])

  return { handleImageSelect }
}
