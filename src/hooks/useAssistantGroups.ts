import { useMemo } from 'react'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { getModelLogo } from '@/lib/model-logos'
import {
  getAssistantAvatarImage,
  getAssistantSubtitle,
  UNGROUPED_GROUP_NAME,
} from '@/lib/assistant-utils'
import type { AssistantGroup } from '@/components/assistant-list'

export function useAssistantGroups(): AssistantGroup[] {
  const assistants = useAssistantStore((state) => state.assistants)
  const getModelById = useModelStore((state) => state.getModelById)

  return useMemo(() => {
    if (assistants.length === 0) return []

    // Group assistants by group_name
    const groupMap = new Map<string, typeof assistants>()

    assistants.forEach((assistant) => {
      const groupName = assistant.group_name || UNGROUPED_GROUP_NAME
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, [])
      }
      groupMap.get(groupName)!.push(assistant)
    })

    // Convert map to AssistantGroup array
    const groups: AssistantGroup[] = []

    // Sort groups: "Ungrouped" first, then alphabetically
    const sortedGroupNames = Array.from(groupMap.keys()).sort((a, b) => {
      if (a === UNGROUPED_GROUP_NAME) return -1
      if (b === UNGROUPED_GROUP_NAME) return 1
      return a.localeCompare(b)
    })

    sortedGroupNames.forEach((groupName, index) => {
      const groupAssistants = groupMap.get(groupName)!

      groups.push({
        // Prefix the raw name so distinct names never share a key
        id: `group:${groupName}`,
        name: groupName,
        defaultOpen: index === 0, // Open first group by default
        assistants: groupAssistants.map((a) => {
          const assistantModel = getModelById(a.model_id)
          const modelLogo = assistantModel ? getModelLogo(assistantModel) : undefined

          return {
            id: a.id,
            name: a.name,
            modelName: assistantModel?.name,
            modelId: assistantModel?.model_id,
            persona: getAssistantSubtitle(a),
            description: a.description,
            logo: getAssistantAvatarImage(a),
            avatarBg: a.avatar_bg || '#3b82f6',
            avatarText: a.avatar_text || a.name.charAt(0),
            capabilities: {
              modelLogo: modelLogo,
              hasModel: true,
              hasTools: a.tool_ids.length > 0 || a.skill_ids.length > 0,
            },
            isStarred: a.is_starred || false,
          }
        }),
      })
    })

    return groups
  }, [assistants, getModelById])
}
