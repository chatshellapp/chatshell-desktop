import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { type Attachment, getMimeType, SUPPORTED_DOCUMENT_EXTENSIONS } from '../types'
import { logger } from '@/lib/logger'

export interface UseFileSelectReturn {
  handleFileSelect: () => Promise<void>
}

export function useFileSelect(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
): UseFileSelectReturn {
  const handleFileSelect = useCallback(async () => {
    try {
      logger.info('[handleFileSelect] Opening file dialog...')
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Documents',
            extensions: SUPPORTED_DOCUMENT_EXTENSIONS,
          },
        ],
      })

      logger.info('[handleFileSelect] Dialog result:', selected)

      if (!selected) {
        logger.info('[handleFileSelect] No file selected')
        return
      }

      const files = Array.isArray(selected) ? selected : [selected]
      logger.info('[handleFileSelect] Files to process:', files)

      for (const filePath of files) {
        logger.info('[handleFileSelect] Reading file:', filePath)
        // Use Rust command to read file (avoids plugin-fs scope issues)
        const content = await invoke<string>('read_text_file_from_path', { path: filePath })
        logger.info('[handleFileSelect] File read, length:', content.length)

        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file'

        const newAttachment: Attachment = {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'file',
          name: fileName,
          content,
          mimeType: getMimeType(fileName),
          size: content.length,
        }
        logger.info('[handleFileSelect] Created attachment', {
          name: newAttachment.name,
          size: newAttachment.size,
        })
        setAttachments((prev) => {
          logger.info('[handleFileSelect] Updating attachments, prev count:', prev.length)
          return [...prev, newAttachment]
        })
      }
      logger.info('[handleFileSelect] Done processing files')
    } catch (error) {
      logger.error('[handleFileSelect] Failed to select file:', error)
    }
  }, [setAttachments])

  return { handleFileSelect }
}
