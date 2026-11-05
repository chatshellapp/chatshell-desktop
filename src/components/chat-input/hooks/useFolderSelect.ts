import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { Attachment } from '../types'
import { logger } from '@/lib/logger'

export interface UseFolderSelectReturn {
  handleFolderSelect: () => Promise<void>
}

/**
 * Attach a folder as a one-level listing with its absolute path. The model
 * explores deeper with its own tools; the folder grants no access and does
 * not change the working directory.
 */
export function useFolderSelect(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
): UseFolderSelectReturn {
  const { t } = useTranslation('messages')
  const handleFolderSelect = useCallback(async () => {
    let selected: string | string[] | null
    try {
      selected = await open({ directory: true, multiple: false })
    } catch (error) {
      logger.error('[handleFolderSelect] Failed to open folder dialog:', error)
      return
    }
    if (!selected) return
    const folderPath = Array.isArray(selected) ? selected[0] : selected
    const trimmed = folderPath.replace(/[\\/]+$/, '')
    const folderName = trimmed.split(/[\\/]/).pop() || trimmed
    try {
      const listing = await invoke<string>('list_folder_for_attachment', { path: folderPath })
      const attachment: Attachment = {
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: 'file',
        name: `${folderName}/`,
        content: listing,
        mimeType: 'text/plain',
        size: listing.length,
      }
      setAttachments((prev) => [...prev, attachment])
    } catch (error) {
      logger.error(`[handleFolderSelect] Failed to list folder: ${folderPath}`, error)
      toast.error(t('failedToReadFile', { file: folderName }), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [setAttachments, t])

  return { handleFolderSelect }
}
