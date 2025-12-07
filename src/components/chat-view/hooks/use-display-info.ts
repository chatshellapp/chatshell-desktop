import { useCallback } from 'react'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { getModelLogo } from '@/lib/model-logos'
import { formatModelDisplayName } from '../utils'
import type { Message, Model, Assistant } from '@/types'

export interface DisplayInfo {
  displayName: string
  senderType: 'model' | 'assistant'
  modelLogo?: string
  assistantLogo?: string
  avatarBg?: string
  avatarText?: string
}

interface UseDisplayInfoOptions {
  selectedModel: Model | null
  selectedAssistant: Assistant | null
}

export function useDisplayInfo({ selectedModel, selectedAssistant }: UseDisplayInfoOptions) {
  const getModelById = useModelStore((state) => state.getModelById)
  const getProviderById = useModelStore((state) => state.getProviderById)
  const getAssistantById = useAssistantStore((state) => state.getAssistantById)

  // Get display info for currently selected model/assistant (used for streaming messages)
  const getDisplayInfo = useCallback((): DisplayInfo => {
    if (selectedAssistant) {
      const model = getModelById(selectedAssistant.model_id)
      const modelName = model ? model.name : 'Unknown Model'

      // Return assistant info
      if (selectedAssistant.avatar_type === 'image') {
        return {
          displayName: `${selectedAssistant.name} · ${modelName}`,
          senderType: 'assistant',
          assistantLogo: selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path,
        }
      } else {
        // Text/emoji avatar
        return {
          displayName: `${selectedAssistant.name} · ${modelName}`,
          senderType: 'assistant',
          avatarBg: selectedAssistant.avatar_bg || undefined,
          avatarText: selectedAssistant.avatar_text || undefined,
        }
      }
    } else if (selectedModel) {
      return {
        displayName: formatModelDisplayName(
          selectedModel.name,
          selectedModel.provider_id,
          getProviderById
        ),
        senderType: 'model',
        modelLogo: getModelLogo(selectedModel),
      }
    }
    return { displayName: 'AI Assistant', senderType: 'model' }
  }, [selectedAssistant, selectedModel, getModelById, getProviderById])

  // Get display info for a specific message based on its sender_id and sender_type
  const getMessageDisplayInfo = useCallback(
    (message: Message): DisplayInfo => {
      if (!message.sender_id) {
        return { displayName: 'AI Assistant', senderType: 'model' }
      }

      // Handle different sender types
      if (message.sender_type === 'model') {
        // Direct model chat
        const model = getModelById(message.sender_id)
        if (model) {
          return {
            displayName: formatModelDisplayName(model.name, model.provider_id, getProviderById),
            senderType: 'model',
            modelLogo: getModelLogo(model),
          }
        }
      } else if (message.sender_type === 'assistant') {
        // Assistant chat
        const assistant = getAssistantById(message.sender_id)
        if (assistant) {
          const assistantModel = getModelById(assistant.model_id)
          const modelName = assistantModel ? assistantModel.name : 'Unknown Model'

          // Return assistant info
          if (assistant.avatar_type === 'image') {
            return {
              displayName: `${assistant.name} · ${modelName}`,
              senderType: 'assistant',
              assistantLogo: assistant.avatar_image_url || assistant.avatar_image_path,
            }
          } else {
            // Text/emoji avatar
            return {
              displayName: `${assistant.name} · ${modelName}`,
              senderType: 'assistant',
              avatarBg: assistant.avatar_bg || undefined,
              avatarText: assistant.avatar_text || undefined,
            }
          }
        }
      }

      return { displayName: 'AI Assistant', senderType: 'model' }
    },
    [getModelById, getProviderById, getAssistantById]
  )

  return {
    getDisplayInfo,
    getMessageDisplayInfo,
  }
}

