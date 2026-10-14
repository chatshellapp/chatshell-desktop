import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Message, MessageResources } from '@/types'
import { logger } from '@/lib/logger'

interface UseMessageResourcesOptions {
  messages: Message[]
  attachmentStatus: string
  attachmentRefreshKey: number
}

export function useMessageResources({
  messages,
  attachmentStatus,
  attachmentRefreshKey,
}: UseMessageResourcesOptions) {
  // Store resources for each message (keyed by message id)
  // Contains { attachments, contexts, steps } for each message
  const [messageResources, setMessageResources] = useState<Record<string, MessageResources>>({})
  const lastRefreshKeyRef = useRef<number | null>(null)
  // Message ids already fetched that turned out to have no resources; avoids
  // re-querying them on every effect run (R4.2).
  const checkedEmptyRef = useRef<Set<string>>(new Set())

  // Fetch resources (attachments, contexts, steps) for messages
  // Re-run when attachmentStatus changes to 'complete' or attachmentRefreshKey changes
  useEffect(() => {
    // A refresh-key bump means storage_paths were just repaired by a blob
    // pass (fetch-on-open rewrites iOS-authored absolute paths) — cached
    // resources may hold stale foreign paths, so re-resolve EVERYTHING,
    // not just the latest message (real-device 2026-08-28).
    const refreshAll =
      lastRefreshKeyRef.current !== null && lastRefreshKeyRef.current !== attachmentRefreshKey
    lastRefreshKeyRef.current = attachmentRefreshKey
    if (refreshAll) {
      checkedEmptyRef.current.clear()
    }

    const fetchResources = async () => {
      const lastMessage = messages[messages.length - 1]
      const idsToFetch: string[] = []
      for (const msg of messages) {
        // When processing just completed or refresh key changed, always
        // re-fetch for the latest message; otherwise skip anything already
        // resolved (cached resources or a known-empty result).
        const shouldRefetchLatest =
          (attachmentStatus === 'complete' || attachmentRefreshKey > 0) && msg === lastMessage
        if (shouldRefetchLatest || refreshAll) {
          idsToFetch.push(msg.id)
          continue
        }
        if (messageResources[msg.id] || checkedEmptyRef.current.has(msg.id)) continue
        idsToFetch.push(msg.id)
      }

      if (idsToFetch.length === 0) return

      try {
        // Single bulk IPC for the whole window (R4.2); the command returns
        // only messages that actually have resources.
        const fetched = await invoke<Record<string, MessageResources>>(
          'get_message_resources_batch',
          { messageIds: idsToFetch }
        )
        for (const id of idsToFetch) {
          if (!fetched[id]) checkedEmptyRef.current.add(id)
        }
        if (Object.keys(fetched).length > 0) {
          setMessageResources((prev) => ({ ...prev, ...fetched }))
        }
      } catch (e) {
        logger.error('Failed to fetch message resources (batch)', e)
      }
    }

    if (messages.length > 0) {
      void fetchResources()
    }
  }, [messages, attachmentStatus, attachmentRefreshKey])

  return messageResources
}
