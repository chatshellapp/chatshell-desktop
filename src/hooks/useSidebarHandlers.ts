import { useCallback } from 'react'
import { useNewConversation } from '@/hooks/useNewConversation'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useConversationStore } from '@/stores/conversation'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { usePromptStore } from '@/stores/promptStore'
import type { Model as ModelListItem } from '@/components/model-list'
import type {
  Assistant as AssistantListItem,
  AssistantGroup as AssistantGroupListItem,
} from '@/components/assistant-list'
import type {
  Prompt as PromptListItem,
  PromptGroup as PromptGroupListItem,
} from '@/components/prompt-list'
import { logger } from '@/lib/logger'
import type { Assistant as AssistantDB, Prompt as PromptDB } from '@/types'
import { toPromptRequest, UNCATEGORIZED_CATEGORY } from '@/lib/prompt-utils'
import { toAssistantRequest, UNGROUPED_GROUP_NAME } from '@/lib/assistant-utils'

export function useSidebarHandlers() {
  const { t } = useTranslation('messages')
  const openDraftConversation = useConversationStore((state) => state.openDraftConversation)
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
  const createAssistant = useAssistantStore((state) => state.createAssistant)
  const deleteAssistant = useAssistantStore((state) => state.deleteAssistant)
  const prompts = usePromptStore((state) => state.prompts)
  const deletePrompt = usePromptStore((state) => state.deletePrompt)
  const createPrompt = usePromptStore((state) => state.createPrompt)
  const updatePrompt = usePromptStore((state) => state.updatePrompt)
  const setPendingInput = useConversationStore((state) => state.setPendingInput)

  const handleModelClick = useCallback(
    async (model: ModelListItem) => {
      const realModel = getModelById(model.id)
      if (!realModel) {
        logger.error('Model not found:', model.id)
        return
      }

      try {
        // The draft's settings are in place before they are adjusted below
        const targetConversation = await openDraftConversation()

        const previousAssistant = useConversationStore.getState().selectedAssistant
        setSelectedModel(realModel)

        // Reset tools/skills and any inherited preset when switching away from an assistant
        if (previousAssistant) {
          const settingsStore = useConversationSettingsStore.getState()
          await settingsStore.resetToolsAndSkillsToGlobal(targetConversation.id)
          await settingsStore.clearInheritedPreset(targetConversation.id, previousAssistant)
        }
      } catch (error) {
        logger.error('Failed to handle model click:', error)
        toast.error(t('failedToSelectModel'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [getModelById, openDraftConversation, setSelectedModel]
  )

  const handleAssistantClick = useCallback(
    async (assistant: AssistantListItem) => {
      const realAssistant = assistants.find((a) => a.id === assistant.id)
      if (!realAssistant) {
        logger.error('Assistant not found:', assistant.id)
        return
      }

      try {
        // The draft's settings are in place before they are adjusted below
        const targetConversation = await openDraftConversation()
        setSelectedAssistant(realAssistant)

        // Initialize conversation settings with the assistant's tools and skills
        await useConversationSettingsStore
          .getState()
          .initSettingsFromAssistant(targetConversation.id, realAssistant)
      } catch (error) {
        logger.error('Failed to handle assistant click:', error)
        toast.error(t('failedToSelectAssistant'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [assistants, openDraftConversation, setSelectedAssistant]
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
          await updateAssistant(
            realAssistant.id,
            toAssistantRequest(realAssistant, {
              is_starred: !realAssistant.is_starred,
            })
          )
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
        toast.error(t('failedToDeleteModel'), {
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
        toast.error(t('failedToDeleteAssistant'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [assistants, deleteAssistant]
  )

  /**
   * Move every assistant in a group to a new group name. An empty name
   * ungroups them. Returns true when all updates succeeded.
   */
  const handleAssistantGroupRename = useCallback(
    async (group: AssistantGroupListItem, newName: string): Promise<boolean> => {
      const trimmed = newName.trim()
      const targetGroupName = trimmed && trimmed !== UNGROUPED_GROUP_NAME ? trimmed : undefined
      const members = assistants.filter(
        (a) => (a.group_name || UNGROUPED_GROUP_NAME) === group.name
      )

      try {
        for (const member of members) {
          if (member.group_name === targetGroupName) continue
          await updateAssistant(
            member.id,
            toAssistantRequest(member, { group_name: targetGroupName })
          )
        }
        return true
      } catch (error) {
        logger.error('Failed to rename assistant group:', error)
        toast.error(t('failedToRenameAssistantGroup'), {
          description: error instanceof Error ? error.message : String(error),
        })
        return false
      }
    },
    [assistants, updateAssistant, t]
  )

  /**
   * Create an unstarred copy of an assistant, including its tools and skills.
   * Returns the new assistant, or null on failure.
   */
  const handleAssistantDuplicate = useCallback(
    async (assistant: AssistantListItem, copyName: string): Promise<AssistantDB | null> => {
      const realAssistant = assistants.find((a) => a.id === assistant.id)
      if (!realAssistant) {
        logger.error('Assistant not found:', assistant.id)
        return null
      }

      try {
        return await createAssistant({
          ...toAssistantRequest(realAssistant, { name: copyName, is_starred: false }),
          tool_ids: [...realAssistant.tool_ids],
          skill_ids: [...realAssistant.skill_ids],
        })
      } catch (error) {
        logger.error('Failed to duplicate assistant:', error)
        toast.error(t('failedToDuplicateAssistant'), {
          description: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    },
    [assistants, createAssistant, t]
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
        toast.error(t('failedToDeletePrompt'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [prompts, deletePrompt]
  )

  /**
   * Start a new draft chat with a library prompt. System prompts become the
   * draft's system prompt setting; user prompts prefill the message input.
   */
  const handlePromptUse = useCallback(
    async (prompt: PromptListItem) => {
      const realPrompt = prompts.find((p) => p.id === prompt.id)
      if (!realPrompt) {
        logger.error('Prompt not found:', prompt.id)
        return
      }

      try {
        if (realPrompt.is_system) {
          const draft = await openDraftConversation()
          await useConversationSettingsStore
            .getState()
            .setSystemPrompt(draft.id, 'existing', realPrompt.id)
        } else {
          setPendingInput(realPrompt.content)
          await openDraftConversation()
        }
      } catch (error) {
        logger.error('Failed to use prompt:', error)
        toast.error(t('failedToUsePrompt'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [prompts, openDraftConversation, setPendingInput, t]
  )

  /**
   * Put a user prompt into the current chat's input, or a new draft when no
   * chat is open
   */
  const handlePromptInsert = useCallback(
    async (prompt: PromptListItem) => {
      const realPrompt = prompts.find((p) => p.id === prompt.id)
      if (!realPrompt) {
        logger.error('Prompt not found:', prompt.id)
        return
      }
      setPendingInput(realPrompt.content)
      if (!useConversationStore.getState().currentConversation) {
        try {
          await openDraftConversation()
        } catch (error) {
          logger.error('Failed to open draft for prompt insert:', error)
        }
      }
    },
    [prompts, openDraftConversation, setPendingInput]
  )

  /**
   * Create a copy of a prompt. Returns the new prompt, or null on failure.
   */
  const handlePromptDuplicate = useCallback(
    async (prompt: PromptListItem, copyName: string): Promise<PromptDB | null> => {
      const realPrompt = prompts.find((p) => p.id === prompt.id)
      if (!realPrompt) {
        logger.error('Prompt not found:', prompt.id)
        return null
      }

      try {
        return await createPrompt(toPromptRequest(realPrompt, { name: copyName }))
      } catch (error) {
        logger.error('Failed to duplicate prompt:', error)
        toast.error(t('failedToDuplicatePrompt'), {
          description: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    },
    [prompts, createPrompt, t]
  )

  /**
   * Move every prompt in a category to a new name. An empty name clears the
   * category. Returns true when all updates succeeded.
   */
  const handlePromptCategoryRename = useCallback(
    async (group: PromptGroupListItem, newName: string): Promise<boolean> => {
      const trimmed = newName.trim()
      const targetCategory = trimmed && trimmed !== UNCATEGORIZED_CATEGORY ? trimmed : undefined
      const members = prompts.filter((p) => (p.category || UNCATEGORIZED_CATEGORY) === group.name)

      try {
        for (const member of members) {
          if (member.category === targetCategory) continue
          await updatePrompt(member.id, toPromptRequest(member, { category: targetCategory }))
        }
        return true
      } catch (error) {
        logger.error('Failed to rename prompt category:', error)
        toast.error(t('failedToRenamePromptCategory'), {
          description: error instanceof Error ? error.message : String(error),
        })
        return false
      }
    },
    [prompts, updatePrompt, t]
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

  const handleNewConversation = useNewConversation()

  const handleGenerateTitle = useCallback(
    async (conversationId: string) => {
      try {
        const newTitle = await invoke<string>('generate_conversation_title_manually', {
          conversationId,
        })
        await updateConversation(conversationId, newTitle)
      } catch (error) {
        logger.error('Failed to generate title:', error)
        toast.error(t('failedToGenerateTitle'), {
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
    handleAssistantGroupRename,
    handleAssistantDuplicate,
    handlePromptDelete,
    handlePromptUse,
    handlePromptInsert,
    handlePromptDuplicate,
    handlePromptCategoryRename,
    handleConversationClick,
    handleNewConversation,
    handleGenerateTitle,
    handleEditTitle,
    handleDeleteConversation,
  }
}
