import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { type Attachment, SUPPORTED_DOCUMENT_EXTENSIONS } from '../types'
import {
  isRejected,
  readDocumentFromPath,
  reportRejected,
  type RejectedFile,
} from '../attachment-ingest'
import { logger } from '@/lib/logger'

export interface UseFileSelectReturn {
  handleFileSelect: () => Promise<void>
}

export function useFileSelect(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
): UseFileSelectReturn {
  const { t } = useTranslation('messages')
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

      const rejected: RejectedFile[] = []
      for (const filePath of files) {
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file'
        try {
          logger.info('[handleFileSelect] Reading file:', filePath)
          const result = await readDocumentFromPath(t, filePath, fileName)
          if (isRejected(result)) {
            rejected.push(result)
            continue
          }
          setAttachments((prev) => [...prev, result])
        } catch (error) {
          logger.error(`[handleFileSelect] Failed to read file: ${filePath}`, error)
          toast.error(t('failedToReadFile', { file: fileName }), {
            description: error instanceof Error ? error.message : String(error),
          })
        }
      }
      reportRejected(t, rejected)
      logger.info('[handleFileSelect] Done processing files')
    } catch (error) {
      logger.error('[handleFileSelect] Failed to select file:', error)
    }
  }, [setAttachments, t])

  return { handleFileSelect }
}
