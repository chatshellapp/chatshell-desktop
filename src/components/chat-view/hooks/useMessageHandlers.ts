import { useCallback, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { logger } from '@/lib/logger'
import {
  saveScreenshot,
  saveScreenshotMulti,
  findMessageElement,
  findStreamingMessageElement,
} from '@/lib/screenshot'
import { useMessageStore } from '@/stores/message'
import { useConversationStore } from '@/stores/conversation'
import { useModelStore } from '@/stores/modelStore'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { usePromptStore } from '@/stores/promptStore'
import type { Conversation, MessageResources } from '@/types'

export interface UseMessageHandlersOptions {
  messagesEndRef: RefObject<HTMLDivElement | null>
  messagesContentRef: RefObject<HTMLDivElement | null>
  setIsAtBottom: (value: boolean) => void
}

export interface UseMessageHandlersReturn {
  handleCopy: () => void
  handleRevert: (messageId: string) => Promise<void>
  handleFork: (messageId: string) => Promise<void>
  handleExportAll: () => Promise<void>
  handleExportConversation: (messageId: string | null) => Promise<void>
  handleExportMessage: (messageId: string) => void
  handleScrollToBottom: () => void
}

export function useMessageHandlers({
  messagesEndRef,
  messagesContentRef,
  setIsAtBottom,
}: UseMessageHandlersOptions): UseMessageHandlersReturn {
  const { t } = useTranslation('messages')
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)
  const getModelById = useModelStore((state) => state.getModelById)
  const getProviderById = useModelStore((state) => state.getProviderById)
  const getSettings = useConversationSettingsStore((state) => state.getSettings)
  const loadSettings = useConversationSettingsStore((state) => state.loadSettings)
  const getPromptById = usePromptStore((state) => state.getPromptById)

  const deleteMessagesFrom = useMessageStore((state) => state.deleteMessagesFrom)
  const sendMessage = useMessageStore((state) => state.sendMessage)
  const getConversationState = useMessageStore((state) => state.getConversationState)
  const loadAllMessages = useMessageStore((state) => state.loadAllMessages)

  const handleCopy = useCallback(() => {
    logger.info('Message copied')
  }, [])

  const handleRevert = useCallback(
    async (messageId: string) => {
      if (!currentConversation) {
        toast.error(t('noActiveConversation'))
        return
      }

      const convState = getConversationState(currentConversation.id)
      const message = convState.messages.find((m) => m.id === messageId)
      if (!message || message.sender_type !== 'user') {
        toast.error(t('cannotRevertMessage'))
        return
      }

      const content = message.content

      const modelToUse = selectedAssistant
        ? getModelById(selectedAssistant.model_id)
        : selectedModel

      if (!modelToUse) {
        toast.error(t('pleaseSelectModelOrAssistant'))
        return
      }

      const provider = getProviderById(modelToUse.provider_id)
      if (!provider) {
        toast.error(t('providerConfigNotFound'))
        return
      }

      try {
        // Retrieve original attachments before deleting the message
        const resources = await invoke<MessageResources>('get_message_resources', {
          messageId,
        })

        const imageAttachments = resources.attachments.filter(
          (a) => a.type === 'file' && a.mime_type?.startsWith('image/')
        )
        const fileAttachments = resources.attachments.filter(
          (a) => a.type === 'file' && !a.mime_type?.startsWith('image/')
        )
        const reuseFetchResultIds = resources.contexts
          .filter((c) => c.type === 'fetch_result' && c.source_type === 'user_link')
          .map((c) => c.id)

        const [images, files] = await Promise.all([
          Promise.all(
            imageAttachments.map(async (a) => {
              const base64 = await invoke<string>('read_image_base64', {
                storagePath: a.storage_path,
              })
              return { name: a.file_name, base64, mimeType: a.mime_type }
            })
          ),
          Promise.all(
            fileAttachments.map(async (a) => {
              const fileContent = await invoke<string>('read_file_content', {
                storagePath: a.storage_path,
              })
              return { name: a.file_name, content: fileContent, mimeType: a.mime_type }
            })
          ),
        ])

        await deleteMessagesFrom(currentConversation.id, messageId)

        const settings =
          getSettings(currentConversation.id) ?? (await loadSettings(currentConversation.id))

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
          images.length > 0 ? images : undefined,
          files.length > 0 ? files : undefined,
          false,
          parameterOverrides,
          contextMessageCount,
          useProviderDefaults,
          reuseFetchResultIds.length > 0 ? reuseFetchResultIds : undefined
        )
      } catch (error) {
        logger.error('Failed to revert message:', error)
        toast.error(t('failedToRevertMessage'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [
      currentConversation,
      selectedModel,
      selectedAssistant,
      loadSettings,
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
        toast.error(t('noActiveConversation'))
        return
      }

      try {
        const newConversation = await invoke<Conversation>('fork_conversation', {
          conversationId: currentConversation.id,
          messageId,
        })
        await loadConversations()
        await selectConversation(newConversation.id)
        toast.success(t('conversationForked'))
      } catch (error) {
        logger.error('Failed to fork conversation:', error)
        toast.error(t('failedToForkConversation'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [currentConversation, loadConversations, selectConversation]
  )

  const handleExportAll = useCallback(async () => {
    const el = messagesContentRef.current
    if (!el) {
      toast.error(t('noMessagesToCapture'))
      return
    }

    // Capture must not inherit the chat window's lazy rendering: expand the
    // store to the full history, then wait for the progressive list to mount
    // every row. Otherwise the screenshot contains only the loaded tail (or
    // the first 16 rows if the list is still mounting).
    const scrollContainer = el.parentElement
    const previousHeight = scrollContainer?.scrollHeight ?? 0
    const previousTop = scrollContainer?.scrollTop ?? 0

    if (currentConversation) {
      const conversationId = currentConversation.id
      await loadAllMessages(conversationId)
      const convState = getConversationState(conversationId)
      if (convState.hasOlderMessages) {
        toast.error(t('failedToExportAllMessages'))
        return
      }

      const expectedRows = convState.messages.length
      const deadline = performance.now() + 10_000
      while (
        el.querySelectorAll('[data-message-id]').length < expectedRows &&
        performance.now() < deadline
      ) {
        const { promise, resolve } = Promise.withResolvers<void>()
        requestAnimationFrame(() => resolve())
        await promise
      }
      if (el.querySelectorAll('[data-message-id]').length < expectedRows) {
        toast.error(t('failedToExportAllMessages'))
        return
      }
    }

    // Paging history in and mounting the earlier rows grows the list above
    // the viewport; shift scrollTop by the same delta so exporting does not
    // teleport the reader.
    if (scrollContainer) {
      const growth = scrollContainer.scrollHeight - previousHeight
      if (growth > 0) scrollContainer.scrollTop = previousTop + growth
    }

    const ok = await saveScreenshot(el)
    if (ok) toast.success(t('screenshotSaved'))
  }, [currentConversation, getConversationState, loadAllMessages, messagesContentRef, t])

  const handleExportConversation = useCallback(
    async (messageId: string | null) => {
      if (!currentConversation) {
        toast.error(t('noActiveConversation'))
        return
      }

      const elements: HTMLElement[] = []

      if (messageId === null) {
        // Streaming case: pair last user message with the in-progress streaming message
        const convState = getConversationState(currentConversation.id)
        const lastUser = [...convState.messages].reverse().find((m) => m.sender_type === 'user')
        if (lastUser) {
          const userEl = findMessageElement(lastUser.id)
          if (userEl) elements.push(userEl)
        }
        const streamingEl = findStreamingMessageElement()
        if (streamingEl) elements.push(streamingEl)
      } else {
        const convState = getConversationState(currentConversation.id)
        const msgs = convState.messages
        const idx = msgs.findIndex((m) => m.id === messageId)
        if (idx === -1) {
          toast.error(t('couldNotFindMessage'))
          return
        }

        const current = msgs[idx]
        let userMessageId: string | null = null
        let assistantMessageId: string | null = null

        if (current.sender_type === 'user') {
          userMessageId = current.id
          for (let i = idx + 1; i < msgs.length; i++) {
            if (msgs[i].sender_type !== 'user') {
              assistantMessageId = msgs[i].id
              break
            }
          }
        } else {
          assistantMessageId = current.id
          for (let i = idx - 1; i >= 0; i--) {
            if (msgs[i].sender_type === 'user') {
              userMessageId = msgs[i].id
              break
            }
          }
        }

        if (userMessageId) {
          const el = findMessageElement(userMessageId)
          if (el) elements.push(el)
        }
        if (assistantMessageId) {
          const el = findMessageElement(assistantMessageId)
          if (el) elements.push(el)
        }
      }

      if (elements.length === 0) {
        toast.error(t('couldNotFindMessage'))
        return
      }

      const ok = await saveScreenshotMulti(elements)
      if (ok) toast.success(t('screenshotSaved'))
    },
    [currentConversation, getConversationState, t]
  )

  const handleExportMessage = useCallback((messageId: string) => {
    const el = findMessageElement(messageId)
    if (!el) {
      toast.error(t('couldNotFindMessage'))
      return
    }
    saveScreenshot(el).then((ok) => {
      if (ok) toast.success(t('screenshotSaved'))
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
