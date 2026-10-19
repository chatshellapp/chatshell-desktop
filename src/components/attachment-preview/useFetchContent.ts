import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { FetchResult } from '@/types'
import { logger } from '@/lib/logger'

// Loads fetch-result content from the filesystem while the dialog is open.
// Latches load failures so a rejecting read does not retry in a tight loop;
// closing the dialog clears the latch so reopening can retry.
export function useFetchContent(fetchResult: FetchResult, isDialogOpen: boolean) {
  const [content, setContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!isDialogOpen) {
      setLoadFailed(false)
    }
  }, [isDialogOpen])

  useEffect(() => {
    if (
      isDialogOpen &&
      !content &&
      !loadingContent &&
      !loadFailed &&
      fetchResult.status === 'success'
    ) {
      setLoadingContent(true)
      invoke<string>('read_fetch_content', { storagePath: fetchResult.storage_path })
        .then(setContent)
        .catch((err) => {
          logger.error('Failed to load fetch content:', err)
          setLoadFailed(true)
        })
        .finally(() => setLoadingContent(false))
    }
  }, [isDialogOpen, content, loadingContent, loadFailed, fetchResult])

  return { content, loadingContent }
}
