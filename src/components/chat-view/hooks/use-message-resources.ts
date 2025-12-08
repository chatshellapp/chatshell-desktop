import { useState, useEffect } from 'react'
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

  // Fetch resources (attachments, contexts, steps) for messages
  // Re-run when attachmentStatus changes to 'complete' or attachmentRefreshKey changes
  useEffect(() => {
    const fetchResources = async () => {
      // Fetch resources for all messages (both user and assistant)
      const resourceMap: Record<string, MessageResources> = {}

      for (const msg of messages) {
        // When processing just completed or refresh key changed, always re-fetch for the latest message
        // Otherwise, skip if we already have resources for this message
        const isLatestMessage = messages.indexOf(msg) === messages.length - 1
        const shouldRefetch =
          (attachmentStatus === 'complete' || attachmentRefreshKey > 0) && isLatestMessage

        if (messageResources[msg.id] && !shouldRefetch) {
          resourceMap[msg.id] = messageResources[msg.id]
          continue
        }

        try {
          const resources = await invoke<MessageResources>('get_message_resources', {
            messageId: msg.id,
          })
          // Only store if there are any resources
          if (
            resources.attachments.length > 0 ||
            resources.contexts.length > 0 ||
            resources.steps.length > 0
          ) {
            resourceMap[msg.id] = resources
          }
        } catch (e) {
          logger.error(`Failed to fetch resources for message: ${msg.id}`, e)
        }
      }

      // Only update if there are changes
      if (Object.keys(resourceMap).length > 0) {
        setMessageResources((prev) => ({ ...prev, ...resourceMap }))
      }
    }

    if (messages.length > 0) {
      fetchResources()
    }
  }, [messages, attachmentStatus, attachmentRefreshKey])

  return messageResources
}
