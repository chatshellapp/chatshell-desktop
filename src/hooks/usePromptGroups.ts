import { useMemo } from 'react'
import { usePromptStore } from '@/stores/promptStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import { UNCATEGORIZED_CATEGORY } from '@/lib/prompt-utils'
import type { PromptGroup } from '@/components/prompt-list'
import type { Prompt } from '@/types'
import { useRelatedConversations, type RelatedConversations } from './useRelatedConversations'

/**
 * Group library prompts by category, keeping the store order
 */
export function usePromptGroups(): PromptGroup[] {
  const prompts = usePromptStore((state) => state.prompts)

  return useMemo(() => {
    const groupsMap = new Map<string, PromptGroup>()

    prompts.forEach((prompt) => {
      const category = prompt.category || UNCATEGORIZED_CATEGORY

      if (!groupsMap.has(category)) {
        groupsMap.set(category, {
          // Prefix the raw name so distinct names never share a key
          id: `category:${category}`,
          name: category,
          defaultOpen: true,
          prompts: [],
        })
      }

      groupsMap.get(category)!.prompts.push({
        id: prompt.id,
        name: prompt.name,
        content: prompt.content,
        isStarred: prompt.is_starred,
        isSystem: prompt.is_system,
      })
    })

    return Array.from(groupsMap.values())
  }, [prompts])
}

/**
 * The selected library prompt, or null when nothing is selected or it was deleted
 */
export function useSelectedPrompt(): Prompt | null {
  const selectedPromptId = useLibrarySelectionStore((state) => state.selectedPromptId)
  const prompts = usePromptStore((state) => state.prompts)

  return useMemo(
    () => (selectedPromptId ? (prompts.find((p) => p.id === selectedPromptId) ?? null) : null),
    [selectedPromptId, prompts]
  )
}

/**
 * Conversations whose settings select this prompt, most recently updated first
 */
export function usePromptConversations(promptId: string | null): RelatedConversations {
  return useRelatedConversations('list_conversation_ids_by_prompt', promptId ? { promptId } : null)
}
