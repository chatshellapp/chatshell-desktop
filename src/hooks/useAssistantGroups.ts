import { useMemo } from 'react'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { getModelLogo } from '@/lib/model-logos'
import type { AssistantGroup } from '@/components/assistant-list'

export function useAssistantGroups(): AssistantGroup[] {
  const assistants = useAssistantStore((state) => state.assistants)
  const getModelById = useModelStore((state) => state.getModelById)

  return useMemo(() => {
    if (assistants.length === 0) return []

    return [
      {
        id: 'all',
        name: 'Assistants',
        defaultOpen: true,
        assistants: assistants.map((a) => {
          const assistantModel = getModelById(a.model_id)
          const modelLogo = assistantModel ? getModelLogo(assistantModel) : undefined

          return {
            id: a.id,
            name: a.name,
            modelName: assistantModel?.name,
            persona: a.role || a.description || (a.system_prompt?.substring(0, 50) + '...') || 'Custom Assistant',
            avatarBg: a.avatar_bg || '#3b82f6',
            avatarText: a.avatar_text || a.name.charAt(0),
            capabilities: {
              modelLogo: modelLogo,
              hasModel: true,
              hasFiles: false,
              hasKnowledgeBase: false,
              hasMcpServer: false,
            },
            isStarred: a.is_starred || false,
          }
        }),
      },
    ]
  }, [assistants, getModelById])
}
