import { useMemo } from 'react'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { useContactSelectionStore, type ContactSelection } from '@/stores/contactSelectionStore'
import { useRelatedConversations, type RelatedConversations } from './useRelatedConversations'
import type { Assistant, Model } from '@/types'

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
 * Conversations the contact takes part in, most recently updated first
 */
export function useContactConversations(selection: ContactSelection | null): RelatedConversations {
  return useRelatedConversations(
    'list_conversation_ids_by_participant',
    selection ? { participantType: selection.kind, participantId: selection.id } : null
  )
}
