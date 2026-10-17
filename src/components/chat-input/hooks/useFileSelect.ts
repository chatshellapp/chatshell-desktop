import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  type Attachment,
  getMimeType,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  isBinaryDocument,
} from '../types'
import { isPdfFile } from '../pdf-text'
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

      for (const filePath of files) {
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file'
        const mimeType = getMimeType(fileName)
        try {
          logger.info('[handleFileSelect] Reading file:', filePath)
          // Use Rust commands to read files (avoids plugin-fs scope issues).
          // PDFs are converted to their text layer: provider-native PDF
          // input is not portable and string-content providers drop it.
          // OOXML documents are ZIP containers: read them as base64 so the
          // read tool can parse the persisted file.
          const binary = isBinaryDocument(fileName)
          const content = binary
            ? ''
            : await invoke<string>(
                isPdfFile(fileName, mimeType)
                  ? 'extract_pdf_text_from_path'
                  : 'read_text_file_from_path',
                { path: filePath }
              )
          const base64 = binary
            ? await invoke<string>('read_file_as_base64', { path: filePath })
            : undefined
          logger.info('[handleFileSelect] File read, length:', content.length)

          const newAttachment: Attachment = {
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'file',
            name: fileName,
            content,
            base64,
            mimeType,
            size: binary ? Math.floor((base64!.length * 3) / 4) : content.length,
          }
          logger.info('[handleFileSelect] Created attachment', {
            name: newAttachment.name,
            size: newAttachment.size,
          })
          setAttachments((prev) => {
            logger.info('[handleFileSelect] Updating attachments, prev count:', prev.length)
            return [...prev, newAttachment]
          })
        } catch (error) {
          logger.error(`[handleFileSelect] Failed to read file: ${filePath}`, error)
          toast.error(t('failedToReadFile', { file: fileName }), {
            description: error instanceof Error ? error.message : String(error),
          })
        }
      }
      logger.info('[handleFileSelect] Done processing files')
    } catch (error) {
      logger.error('[handleFileSelect] Failed to select file:', error)
    }
  }, [setAttachments, t])

  return { handleFileSelect }
}
