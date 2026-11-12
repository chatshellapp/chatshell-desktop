import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { useConversationStore } from '@/stores/conversation'
import { useContactSelectionStore, type ContactSelection } from '@/stores/contactSelectionStore'
import { logger } from '@/lib/logger'
import type { Assistant, Conversation, Model } from '@/types'

export type ResolvedContact =
  | { kind: 'model'; model: Model }
  | { kind: 'assistant'; assistant: Assistant }

/**
 * Resolve the selected contact against the stores. Returns null when nothing
 * is selected or the contact no longer exists (deleted elsewhere).
 */
export function useSelectedContact(): ResolvedContact | null {
  const selected = useContactSelectionStore((state) => state.selected)
  const models = useModelStore((state) => state.models)
  const assistants = useAssistantStore((state) => state.assistants)

  return useMemo(() => {
    if (!selected) return null
    if (selected.kind === 'model') {
      const model = models.find((m) => m.id === selected.id && !m.is_deleted)
      return model ? { kind: 'model', model } : null
    }
    const assistant = assistants.find((a) => a.id === selected.id)
    return assistant ? { kind: 'assistant', assistant } : null
  }, [selected, models, assistants])
}

/**
 * Conversations the contact takes part in, most recently updated first.
 * Re-queries whenever the conversation list changes so new chats show up.
 */
export function useContactConversations(selection: ContactSelection | null): {
  conversations: Conversation[]
  isLoading: boolean
} {
  const allConversations = useConversationStore((state) => state.conversations)
  const [ids, setIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const kind = selection?.kind
  const id = selection?.id

  useEffect(() => {
    if (!kind || !id) {
      setIds([])
      return
    }
    let cancelled = false
    setIsLoading(true)
    invoke<string[]>('list_conversation_ids_by_participant', {
      participantType: kind,
      participantId: id,
    })
      .then((result) => {
        if (!cancelled) setIds(result)
      })
      .catch((error) => {
        logger.error('Failed to load contact conversations:', error)
        if (!cancelled) setIds([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, id, allConversations])

  const conversations = useMemo(() => {
    const byId = new Map(allConversations.map((c) => [c.id, c]))
    return ids.map((cid) => byId.get(cid)).filter((c): c is Conversation => !!c)
  }, [ids, allConversations])

  return { conversations, isLoading }
}
