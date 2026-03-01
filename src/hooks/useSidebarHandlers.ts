import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useConversationStore } from '@/stores/conversation'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { usePromptStore } from '@/stores/promptStore'
import type { Model as ModelListItem } from '@/components/model-list'
import type { Assistant as AssistantListItem } from '@/components/assistant-list'
import type { Prompt as PromptListItem } from '@/components/prompt-list'
import type { Message } from '@/types'
import { logger } from '@/lib/logger'

export function useSidebarHandlers() {
  const conversations = useConversationStore((state) => state.conversations)
  const createConversation = useConversationStore((state) => state.createConversation)
  const selectConversation = useConversationStore((state) => state.selectConversation)
  const updateConversation = useConversationStore((state) => state.updateConversation)
  const deleteConversation = useConversationStore((state) => state.deleteConversation)
  const setSelectedModel = useConversationStore((state) => state.setSelectedModel)
  const setSelectedAssistant = useConversationStore((state) => state.setSelectedAssistant)
  const getModelById = useModelStore((state) => state.getModelById)
  const assistants = useAssistantStore((state) => state.assistants)
  const updateModel = useModelStore((state) => state.updateModel)
  const deleteModel = useModelStore((state) => state.deleteModel)
  const updateAssistant = useAssistantStore((state) => state.updateAssistant)
  const deleteAssistant = useAssistantStore((state) => state.deleteAssistant)
  const prompts = usePromptStore((state) => state.prompts)
  const deletePrompt = usePromptStore((state) => state.deletePrompt)

  const handleModelClick = useCallback(
    async (model: ModelListItem) => {
      const realModel = getModelById(model.id)
      if (!realModel) {
        logger.error('Model not found:', model.id)
        return
      }

      try {
        let targetConversation = null

        if (conversations.length > 0) {
          const latestConversation = conversations[0]
          const messages = await invoke<Message[]>('list_messages_by_conversation', {
            conversationId: latestConversation.id,
          })

          if (messages.length === 0) {
            targetConversation = latestConversation
          }
        }

        if (!targetConversation) {
          targetConversation = await createConversation('New Conversation')
        }

        // Use selectConversation to ensure settings are loaded
        await selectConversation(targetConversation.id)

        const wasPreviouslyAssistant = !!useConversationStore.getState().selectedAssistant
        setSelectedModel(realModel)

        // Reset tools/skills to global defaults when switching away from an assistant
        if (wasPreviouslyAssistant) {
          await useConversationSettingsStore
            .getState()
            .resetToolsAndSkillsToGlobal(targetConversation.id)
        }
      } catch (error) {
        logger.error('Failed to handle model click:', error)
        toast.error('Failed to select model', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [conversations, getModelById, createConversation, setSelectedModel, selectConversation]
  )

  const handleAssistantClick = useCallback(
    async (assistant: AssistantListItem) => {
      const realAssistant = assistants.find((a) => a.id === assistant.id)
      if (!realAssistant) {
        logger.error('Assistant not found:', assistant.id)
        return
      }

      try {
        let targetConversation = null

        if (conversations.length > 0) {
          const latestConversation = conversations[0]
          const messages = await invoke<Message[]>('list_messages_by_conversation', {
            conversationId: latestConversation.id,
          })

          if (messages.length === 0) {
            targetConversation = latestConversation
          }
        }

        if (!targetConversation) {
          targetConversation = await createConversation('New Conversation')
        }

        // Use selectConversation to ensure settings are loaded
        await selectConversation(targetConversation.id)
        setSelectedAssistant(realAssistant)

        // Initialize conversation settings with the assistant's tools and skills
        await useConversationSettingsStore
          .getState()
          .initSettingsFromAssistant(
            targetConversation.id,
            realAssistant.tool_ids,
            realAssistant.skill_ids
          )
      } catch (error) {
        logger.error('Failed to handle assistant click:', error)
        toast.error('Failed to select assistant', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [conversations, assistants, createConversation, setSelectedAssistant, selectConversation]
  )

  const handleModelStarToggle = useCallback(
    async (model: ModelListItem) => {
      const realModel = getModelById(model.id)
      if (realModel) {
        try {
          await updateModel(realModel.id, {
            name: realModel.name,
            provider_id: realModel.provider_id,
            model_id: realModel.model_id,
            description: realModel.description,
            is_starred: !realModel.is_starred,
          })
        } catch (error) {
          logger.error('Failed to toggle star:', error)
        }
      }
    },
    [getModelById, updateModel]
  )

  const handleAssistantStarToggle = useCallback(
    async (assistant: AssistantListItem) => {
      const realAssistant = assistants.find((a) => a.id === assistant.id)
      if (realAssistant) {
        try {
          await updateAssistant(realAssistant.id, {
            name: realAssistant.name,
            system_prompt: realAssistant.system_prompt,
            model_id: realAssistant.model_id,
            avatar_bg: realAssistant.avatar_bg,
            avatar_text: realAssistant.avatar_text,
            group_name: realAssistant.group_name,
            is_starred: !realAssistant.is_starred,
          })
        } catch (error) {
          logger.error('Failed to toggle star:', error)
        }
      }
    },
    [assistants, updateAssistant]
  )

  const handleModelDelete = useCallback(
    async (model: ModelListItem) => {
      const realModel = getModelById(model.id)
      if (!realModel) {
        logger.error('Model not found:', model.id)
        return
      }

      try {
        await deleteModel(realModel.id)
      } catch (error) {
        logger.error('Failed to delete model:', error)
        toast.error('Failed to delete model', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [getModelById, deleteModel]
  )

  const handleAssistantDelete = useCallback(
    async (assistant: AssistantListItem) => {
      const realAssistant = assistants.find((a) => a.id === assistant.id)
      if (!realAssistant) {
        logger.error('Assistant not found:', assistant.id)
        return
      }

      try {
        await deleteAssistant(realAssistant.id)
      } catch (error) {
        logger.error('Failed to delete assistant:', error)
        toast.error('Failed to delete assistant', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [assistants, deleteAssistant]
  )

  const handlePromptDelete = useCallback(
    async (prompt: PromptListItem) => {
      const realPrompt = prompts.find((p) => p.id === prompt.id)
      if (!realPrompt) {
        logger.error('Prompt not found:', prompt.id)
        return
      }

      try {
        await deletePrompt(realPrompt.id)
      } catch (error) {
        logger.error('Failed to delete prompt:', error)
        toast.error('Failed to delete prompt', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [prompts, deletePrompt]
  )

  const handleConversationClick = useCallback(
    async (conversationId: string) => {
      try {
        await selectConversation(conversationId)
      } catch (error) {
        logger.error('Failed to select conversation:', error)
      }
    },
    [selectConversation]
  )

  const handleNewConversation = useCallback(async () => {
    try {
      // Check if the latest conversation is empty
      if (conversations.length > 0) {
        const latestConversation = conversations[0]
        const messages = await invoke<Message[]>('list_messages_by_conversation', {
          conversationId: latestConversation.id,
        })

        if (messages.length === 0) {
          // Latest conversation is empty, navigate to it using selectConversation
          // This ensures proper loading and triggers useEffect for focus
          await selectConversation(latestConversation.id)
          return
        }
      }

      // Create a new conversation and select it (which loads settings)
      const newConversation = await createConversation('New Conversation')
      await selectConversation(newConversation.id)
    } catch (error) {
      logger.error('Failed to create new conversation:', error)
      toast.error('Failed to create conversation', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [conversations, createConversation, selectConversation])

  const handleGenerateTitle = useCallback(
    async (conversationId: string) => {
      try {
        const newTitle = await invoke<string>('generate_conversation_title_manually', {
          conversationId,
        })
        await updateConversation(conversationId, newTitle)
      } catch (error) {
        logger.error('Failed to generate title:', error)
        toast.error('Failed to generate title', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [updateConversation]
  )

  const handleEditTitle = useCallback(
    async (conversationId: string, newTitle: string) => {
      try {
        await updateConversation(conversationId, newTitle)
      } catch (error) {
        logger.error('Failed to update title:', error)
      }
    },
    [updateConversation]
  )

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      try {
        await deleteConversation(conversationId)
      } catch (error) {
        logger.error('Failed to delete conversation:', error)
      }
    },
    [deleteConversation]
  )

  return {
    handleModelClick,
    handleAssistantClick,
    handleModelStarToggle,
    handleAssistantStarToggle,
    handleModelDelete,
    handleAssistantDelete,
    handlePromptDelete,
    handleConversationClick,
    handleNewConversation,
    handleGenerateTitle,
    handleEditTitle,
    handleDeleteConversation,
  }
}
