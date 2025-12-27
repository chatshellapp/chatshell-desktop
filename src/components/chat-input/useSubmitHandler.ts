import { useConversationStore } from '@/stores/conversation'
import { useMessageStore } from '@/stores/message'
import { useModelStore } from '@/stores/ModelStore'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { usePromptStore } from '@/stores/PromptStore'
import type { Attachment } from './types'
import type { Model } from '@/types'
import { logger } from '@/lib/logger'

interface UseSubmitHandlerOptions {
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  attachments: Attachment[]
  clearAttachments: () => void
  webSearchEnabled: boolean
}

export function useSubmitHandler({
  input,
  setInput,
  attachments,
  clearAttachments,
  webSearchEnabled,
}: UseSubmitHandlerOptions) {
  // Store hooks - use granular selectors to avoid unnecessary re-renders
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)

  const getModelById = useModelStore((state) => state.getModelById)
  const getProviderById = useModelStore((state) => state.getProviderById)

  // Get conversation settings
  const getSettings = useConversationSettingsStore((state) => state.getSettings)

  // Get prompt by ID
  const getPromptById = usePromptStore((state) => state.getPromptById)

  // Get conversation-specific state
  const conversationState = useMessageStore((state) =>
    currentConversation ? state.getConversationState(currentConversation.id) : null
  )
  const sendMessage = useMessageStore((state) => state.sendMessage)
  const stopGeneration = useMessageStore((state) => state.stopGeneration)
  const isSending = useMessageStore((state) => state.isSending)

  // Get streaming state from current conversation
  const isStreaming = conversationState?.isStreaming || false
  const isWaitingForAI = conversationState?.isWaitingForAI || false

  const handleSend = async () => {
    logger.info('handleSend called', {
      input: input.trim(),
      hasCurrentConversation: !!currentConversation,
      selectedModel: selectedModel?.name,
      selectedAssistant: selectedAssistant?.name,
    })

    if (!input.trim()) {
      logger.warn('Cannot send: empty input')
      return
    }

    // Check if we have either a model or assistant selected
    if (!selectedModel && !selectedAssistant) {
      alert('Please select a model or assistant first')
      return
    }

    // Determine which model to use
    let modelToUse: Model | undefined

    if (selectedAssistant) {
      // Use assistant's model
      modelToUse = getModelById(selectedAssistant.model_id)
      if (!modelToUse) {
        logger.error('Model not found for assistant:', selectedAssistant.model_id)
        alert('Error: Model configuration not found for assistant')
        return
      }
    } else if (selectedModel) {
      // Use selected model directly
      modelToUse = selectedModel
    } else {
      alert('Please select a model or assistant first')
      return
    }

    // Get provider info
    const provider = getProviderById(modelToUse.provider_id)
    if (!provider) {
      logger.error('Provider not found for model:', modelToUse.provider_id)
      alert('Error: Provider configuration not found')
      return
    }

    const providerType = provider.provider_type
    const modelIdStr = modelToUse.model_id

    const content = input.trim()
    setInput('')

    try {
      // Get API credentials from provider
      const apiKey: string | undefined = provider.api_key
      const baseUrl: string | undefined = provider.base_url

      // Get conversation settings first to check for prompt overrides
      const conversationId = currentConversation?.id
      const settings = conversationId ? getSettings(conversationId) : null

      // Determine system prompt based on conversation settings
      let systemPrompt: string | undefined
      if (settings?.systemPromptMode === 'existing' && settings.selectedSystemPromptId) {
        // Use selected existing prompt
        const prompt = getPromptById(settings.selectedSystemPromptId)
        systemPrompt = prompt?.content
        logger.info('Using existing system prompt from settings:', {
          promptId: settings.selectedSystemPromptId,
        })
      } else if (settings?.systemPromptMode === 'custom' && settings.customSystemPrompt) {
        // Use custom prompt
        systemPrompt = settings.customSystemPrompt
        logger.info('Using custom system prompt from settings')
      } else if (selectedAssistant) {
        // Fall back to assistant's system prompt
        systemPrompt = selectedAssistant.system_prompt
        logger.info('Using assistant system prompt')
      }

      // User prompt is now directly in the input field, so we don't send it separately
      // Only fall back to assistant's user prompt if no user prompt is set in conversation settings
      let userPrompt: string | undefined
      if (settings?.userPromptMode === 'none' && selectedAssistant?.user_prompt) {
        // Only use assistant's user prompt when mode is 'none'
        userPrompt = selectedAssistant.user_prompt
        logger.info('Using assistant user prompt')
      }
      // When userPromptMode is 'existing' or 'custom', the content is already in the input field

      logger.info('Final prompts:', {
        hasSystemPrompt: !!systemPrompt,
        hasUserPrompt: !!userPrompt,
        systemPromptMode: settings?.systemPromptMode,
        userPromptMode: settings?.userPromptMode,
      })

      // Extract file attachments as structured data (sent via rig's Document)
      const fileAttachments = attachments.filter((att) => att.type === 'file' && att.content)
      const files = fileAttachments.map((file) => ({
        name: file.name,
        content: file.content!,
        mimeType: file.mimeType || 'text/plain',
      }))

      // Extract image attachments with filename
      const imageAttachments = attachments.filter((att) => att.type === 'image' && att.base64)
      const images = imageAttachments.map((img) => ({
        name: img.name,
        base64: img.base64!,
        mimeType: img.mimeType || 'image/png',
      }))

      logger.info('Sending message:', {
        content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        conversationId: currentConversation?.id,
        provider: providerType,
        model: modelIdStr,
        hasApiKey: !!apiKey,
        baseUrl,
        hasSystemPrompt: !!systemPrompt,
        hasUserPrompt: !!userPrompt,
        modelDbId: selectedAssistant ? undefined : modelToUse.id,
        assistantDbId: selectedAssistant?.id,
        selectedAssistant: selectedAssistant?.name,
        selectedModel: selectedModel?.name,
        modelToUse: modelToUse?.name,
        fileAttachmentsCount: files.length,
        imagesCount: images.length,
      })

      // Extract webpage URLs from attachments
      const webpageUrls = attachments.filter((att) => att.type === 'webpage').map((att) => att.name)

      // Determine what parameters to send:
      // - useProviderDefaults: true → send flag to skip all parameters
      // - useCustomParameters: true → send custom overrides
      // - selectedPresetId: set → let backend use assistant preset (no overrides sent)
      const useProviderDefaults = settings?.useProviderDefaults ?? false
      const parameterOverrides =
        settings?.useCustomParameters && settings.parameterOverrides
          ? settings.parameterOverrides
          : undefined
      const contextMessageCount = settings?.contextMessageCount ?? undefined

      logger.info('Using conversation settings:', {
        useProviderDefaults: settings?.useProviderDefaults,
        useCustomParameters: settings?.useCustomParameters,
        hasParameterOverrides: !!parameterOverrides,
        contextMessageCount,
      })

      await sendMessage(
        content, // Send original content, files are sent separately
        currentConversation?.id ?? null,
        providerType,
        modelIdStr,
        apiKey,
        baseUrl,
        undefined, // includeHistory
        systemPrompt,
        userPrompt,
        selectedAssistant ? undefined : modelToUse.id, // modelDbId - only send if not using assistant
        selectedAssistant?.id, // assistantDbId
        webpageUrls.length > 0 ? webpageUrls : undefined, // urlsToFetch
        images.length > 0 ? images : undefined, // images
        files.length > 0 ? files : undefined, // files
        webSearchEnabled, // searchEnabled
        parameterOverrides, // parameterOverrides
        contextMessageCount, // contextMessageCount
        useProviderDefaults // useProviderDefaults - skip all parameters when true
      )

      // Clear attachments after sending
      clearAttachments()

      logger.info('Message sent successfully')
    } catch (error) {
      logger.error('Failed to send message:', error)
      alert(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleStop = async () => {
    if (!currentConversation) {
      logger.warn('Cannot stop: no current conversation')
      return
    }

    logger.info('handleStop called for conversation:', currentConversation.id)

    try {
      await stopGeneration(currentConversation.id)
      logger.info('Generation stopped successfully')
    } catch (error) {
      logger.error('Failed to stop generation:', error)
    }
  }

  return {
    handleSend,
    handleStop,
    isStreaming,
    isWaitingForAI,
    isSending,
    selectedModel,
    selectedAssistant,
    currentConversation,
  }
}
