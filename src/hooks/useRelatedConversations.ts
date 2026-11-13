import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useConversationStore } from '@/stores/conversation'
import { logger } from '@/lib/logger'
import type { Conversation } from '@/types'

export interface RelatedConversations {
  conversations: Conversation[]
  isLoading: boolean
}

/**
 * Run a backend command that returns conversation ids (newest first) and map
 * them onto the loaded conversations. Pass null args to skip the query.
 * Re-queries whenever the conversation list changes so new chats show up.
 */
export function useRelatedConversations(
  command: string,
  args: Record<string, string> | null
): RelatedConversations {
  const allConversations = useConversationStore((state) => state.conversations)
  const [ids, setIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  // Stable dependency for the args object, which callers build inline
  const argsKey = args ? JSON.stringify(args) : null

  useEffect(() => {
    if (argsKey === null) {
      setIds([])
      return
    }
    let cancelled = false
    setIsLoading(true)
    invoke<string[]>(command, JSON.parse(argsKey) as Record<string, string>)
      .then((result) => {
        if (!cancelled) setIds(result)
      })
      .catch((error) => {
        logger.error(`Failed to load related conversations (${command}):`, error)
        if (!cancelled) setIds([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [command, argsKey, allConversations])

  const conversations = useMemo(() => {
    const byId = new Map(allConversations.map((c) => [c.id, c]))
    return ids.map((id) => byId.get(id)).filter((c): c is Conversation => !!c)
  }, [ids, allConversations])

  return { conversations, isLoading }
}
