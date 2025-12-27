import { useCallback } from 'react'
import { useModelStore } from '@/stores/ModelStore'
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
  // Extended info for hover card
  assistantName?: string
  assistantRole?: string
  assistantDescription?: string
  assistantModelName?: string
  assistantModelId?: string
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
      const displayName = selectedAssistant.role
        ? `${selectedAssistant.name} · ${selectedAssistant.role}`
        : selectedAssistant.name

      // Get model info for hover card
      const model = getModelById(selectedAssistant.model_id)

      // Return assistant info
      if (selectedAssistant.avatar_type === 'image') {
        return {
          displayName,
          senderType: 'assistant',
          assistantLogo: selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path,
          assistantName: selectedAssistant.name,
          assistantRole: selectedAssistant.role,
          assistantDescription: selectedAssistant.description,
          assistantModelName: model?.name,
          assistantModelId: model?.model_id,
        }
      } else {
        // Text/emoji avatar
        return {
          displayName,
          senderType: 'assistant',
          avatarBg: selectedAssistant.avatar_bg || undefined,
          avatarText: selectedAssistant.avatar_text || undefined,
          assistantName: selectedAssistant.name,
          assistantRole: selectedAssistant.role,
          assistantDescription: selectedAssistant.description,
          assistantModelName: model?.name,
          assistantModelId: model?.model_id,
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
          const displayName = assistant.role
            ? `${assistant.name} · ${assistant.role}`
            : assistant.name

          // Get model info for hover card
          const model = getModelById(assistant.model_id)

          // Return assistant info
          if (assistant.avatar_type === 'image') {
            return {
              displayName,
              senderType: 'assistant',
              assistantLogo: assistant.avatar_image_url || assistant.avatar_image_path,
              assistantName: assistant.name,
              assistantRole: assistant.role,
              assistantDescription: assistant.description,
              assistantModelName: model?.name,
              assistantModelId: model?.model_id,
            }
          } else {
            // Text/emoji avatar
            return {
              displayName,
              senderType: 'assistant',
              avatarBg: assistant.avatar_bg || undefined,
              avatarText: assistant.avatar_text || undefined,
              assistantName: assistant.name,
              assistantRole: assistant.role,
              assistantDescription: assistant.description,
              assistantModelName: model?.name,
              assistantModelId: model?.model_id,
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
