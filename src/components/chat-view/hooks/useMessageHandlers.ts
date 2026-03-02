import { useCallback, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { saveScreenshot, findMessageElement } from '@/lib/screenshot'
import { useMessageStore } from '@/stores/message'
import { useConversationStore } from '@/stores/conversation'
import { useModelStore } from '@/stores/modelStore'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { usePromptStore } from '@/stores/promptStore'
import type { Conversation } from '@/types'

interface UseMessageHandlersOptions {
  messagesEndRef: RefObject<HTMLDivElement | null>
  messagesContentRef: RefObject<HTMLDivElement | null>
  setIsAtBottom: (value: boolean) => void
}

export function useMessageHandlers({
  messagesEndRef,
  messagesContentRef,
  setIsAtBottom,
}: UseMessageHandlersOptions) {
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)
  const getModelById = useModelStore((state) => state.getModelById)
  const getProviderById = useModelStore((state) => state.getProviderById)
  const getSettings = useConversationSettingsStore((state) => state.getSettings)
  const getPromptById = usePromptStore((state) => state.getPromptById)

  const deleteMessagesFrom = useMessageStore((state) => state.deleteMessagesFrom)
  const sendMessage = useMessageStore((state) => state.sendMessage)
  const getConversationState = useMessageStore((state) => state.getConversationState)

  const handleCopy = useCallback(() => {
    logger.info('Message copied')
  }, [])

  const handleRevert = useCallback(
    async (messageId: string) => {
      if (!currentConversation) {
        toast.error('No active conversation')
        return
      }

      const convState = getConversationState(currentConversation.id)
      const message = convState.messages.find((m) => m.id === messageId)
      if (!message || message.sender_type !== 'user') {
        toast.error('Cannot revert: message not found')
        return
      }

      const content = message.content

      let modelToUse = selectedAssistant
        ? getModelById(selectedAssistant.model_id)
        : selectedModel

      if (!modelToUse) {
        toast.error('Please select a model or assistant first')
        return
      }

      const provider = getProviderById(modelToUse.provider_id)
      if (!provider) {
        toast.error('Error: Provider configuration not found')
        return
      }

      try {
        await deleteMessagesFrom(currentConversation.id, messageId)

        const settings = getSettings(currentConversation.id)

        let systemPrompt: string | undefined
        if (settings?.systemPromptMode === 'existing' && settings.selectedSystemPromptId) {
          systemPrompt = getPromptById(settings.selectedSystemPromptId)?.content
        } else if (settings?.systemPromptMode === 'custom' && settings.customSystemPrompt) {
          systemPrompt = settings.customSystemPrompt
        } else if (selectedAssistant) {
          systemPrompt = selectedAssistant.system_prompt
        }

        let userPrompt: string | undefined
        if (settings?.userPromptMode === 'none' && selectedAssistant?.user_prompt) {
          userPrompt = selectedAssistant.user_prompt
        }

        const useProviderDefaults = settings?.useProviderDefaults ?? false
        const parameterOverrides =
          settings?.useCustomParameters && settings.parameterOverrides
            ? settings.parameterOverrides
            : undefined
        const contextMessageCount = settings?.contextMessageCount ?? undefined

        await sendMessage(
          content,
          currentConversation.id,
          provider.provider_type,
          modelToUse.model_id,
          provider.api_key,
          provider.base_url,
          provider.api_style,
          undefined,
          systemPrompt,
          userPrompt,
          selectedAssistant ? undefined : modelToUse.id,
          selectedAssistant?.id,
          undefined,
          undefined,
          undefined,
          false,
          parameterOverrides,
          contextMessageCount,
          useProviderDefaults
        )
      } catch (error) {
        logger.error('Failed to revert message:', error)
        toast.error('Failed to revert message', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [
      currentConversation,
      selectedModel,
      selectedAssistant,
      getModelById,
      getProviderById,
      getSettings,
      getPromptById,
      deleteMessagesFrom,
      sendMessage,
      getConversationState,
    ]
  )

  const loadConversations = useConversationStore((state) => state.loadConversations)
  const selectConversation = useConversationStore((state) => state.selectConversation)

  const handleFork = useCallback(
    async (messageId: string) => {
      if (!currentConversation) {
        toast.error('No active conversation')
        return
      }

      try {
        const newConversation = await invoke<Conversation>('fork_conversation', {
          conversationId: currentConversation.id,
          messageId,
        })
        await loadConversations()
        await selectConversation(newConversation.id)
        toast.success('Conversation forked')
      } catch (error) {
        logger.error('Failed to fork conversation:', error)
        toast.error('Failed to fork conversation', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [currentConversation, loadConversations, selectConversation]
  )

  const handleExportAll = useCallback(() => {
    const el = messagesContentRef.current
    if (!el) {
      toast.error('No messages to capture')
      return
    }
    saveScreenshot(el).then((ok) => {
      if (ok) toast.success('Screenshot saved')
    })
  }, [messagesContentRef])

  const handleExportConversation = useCallback(() => {
    const el = messagesContentRef.current
    if (!el) {
      toast.error('No messages to capture')
      return
    }
    saveScreenshot(el).then((ok) => {
      if (ok) toast.success('Screenshot saved')
    })
  }, [messagesContentRef])

  const handleExportMessage = useCallback((messageId: string) => {
    const el = findMessageElement(messageId)
    if (!el) {
      toast.error('Could not find message element')
      return
    }
    saveScreenshot(el).then((ok) => {
      if (ok) toast.success('Screenshot saved')
    })
  }, [])

  const handleScrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setIsAtBottom(true)
  }, [messagesEndRef, setIsAtBottom])

  return {
    handleCopy,
    handleRevert,
    handleFork,
    handleExportAll,
    handleExportConversation,
    handleExportMessage,
    handleScrollToBottom,
  }
}
