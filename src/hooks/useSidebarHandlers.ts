import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useConversationStore } from '@/stores/conversationStore'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import type { Model, Assistant } from '@/types'

export function useSidebarHandlers() {
  const conversations = useConversationStore((state) => state.conversations)
  const createConversation = useConversationStore((state) => state.createConversation)
  const setCurrentConversation = useConversationStore((state) => state.setCurrentConversation)
  const selectConversation = useConversationStore((state) => state.selectConversation)
  const setSelectedModel = useConversationStore((state) => state.setSelectedModel)
  const setSelectedAssistant = useConversationStore((state) => state.setSelectedAssistant)
  const models = useModelStore((state) => state.models)
  const assistants = useAssistantStore((state) => state.assistants)
  const updateModel = useModelStore((state) => state.updateModel)
  const updateAssistant = useAssistantStore((state) => state.updateAssistant)

  const handleModelClick = useCallback(async (model: Model) => {
    const realModel = models.find((m) => m.id === model.id)
    if (!realModel) return
    
    try {
      let targetConversation = null
      
      if (conversations.length > 0) {
        const latestConversation = conversations[0]
        const messages = await invoke<any[]>('list_messages_by_conversation', {
          conversationId: latestConversation.id
        })
        
        if (messages.length === 0) {
          targetConversation = latestConversation
        }
      }
      
      if (!targetConversation) {
        targetConversation = await createConversation("New Conversation")
      }
      
      setSelectedModel(realModel)
      setCurrentConversation(targetConversation)
    } catch (error) {
      console.error("Failed to handle model click:", error)
      alert(`Failed to select model: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [conversations, models, createConversation, setSelectedModel, setCurrentConversation])

  const handleAssistantClick = useCallback(async (assistant: Assistant) => {
    const realAssistant = assistants.find((a) => a.id === assistant.id)
    if (!realAssistant) return
    
    try {
      let targetConversation = null
      
      if (conversations.length > 0) {
        const latestConversation = conversations[0]
        const messages = await invoke<any[]>('list_messages_by_conversation', {
          conversationId: latestConversation.id
        })
        
        if (messages.length === 0) {
          targetConversation = latestConversation
        }
      }
      
      if (!targetConversation) {
        targetConversation = await createConversation("New Conversation")
      }
      
      setSelectedAssistant(realAssistant)
      setCurrentConversation(targetConversation)
    } catch (error) {
      console.error("Failed to handle assistant click:", error)
      alert(`Failed to select assistant: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [conversations, assistants, createConversation, setSelectedAssistant, setCurrentConversation])

  const handleModelStarToggle = useCallback(async (model: Model) => {
    const realModel = models.find((m) => m.id === model.id)
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
        console.error("Failed to toggle star:", error)
      }
    }
  }, [models, updateModel])

  const handleAssistantStarToggle = useCallback(async (assistant: Assistant) => {
    const realAssistant = assistants.find((a) => a.id === assistant.id)
    if (realAssistant) {
      try {
        await updateAssistant(realAssistant.id, {
          name: realAssistant.name,
          system_prompt: realAssistant.system_prompt,
          model_id: realAssistant.model_id,
          avatar_bg: realAssistant.avatar_bg,
          avatar_text: realAssistant.avatar_text,
          is_starred: !realAssistant.is_starred,
        })
      } catch (error) {
        console.error("Failed to toggle star:", error)
      }
    }
  }, [assistants, updateAssistant])

  const handleConversationClick = useCallback(async (conversationId: string) => {
    try {
      await selectConversation(conversationId)
    } catch (error) {
      console.error("Failed to select conversation:", error)
    }
  }, [selectConversation])

  const handleNewConversation = useCallback(async () => {
    try {
      const newConversation = await createConversation("New Conversation")
      setCurrentConversation(newConversation)
    } catch (error) {
      console.error("Failed to create new conversation:", error)
      alert(`Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [createConversation, setCurrentConversation])

  return {
    handleModelClick,
    handleAssistantClick,
    handleModelStarToggle,
    handleAssistantStarToggle,
    handleConversationClick,
    handleNewConversation,
  }
}

