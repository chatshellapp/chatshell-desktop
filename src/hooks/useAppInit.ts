import { useEffect, useState } from 'react'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { useConversationStore } from '@/stores/conversation'
import { useMessageStore } from '@/stores/message'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore } from '@/stores/userStore'
import { usePromptStore } from '@/stores/promptStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { logger } from '@/lib/logger'

export function useAppInit() {
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Use selector only for reactive state (conversations)
  const conversations = useConversationStore((state: any) => state.conversations)

  // Initialize once on mount - use getState() to avoid dependency issues
  useEffect(() => {
    async function initialize() {
      try {
        logger.info('Initializing app...')

        // Get store actions directly (stable references)
        const settingsStore = useSettingsStore.getState()
        const userStore = useUserStore.getState()
        const modelStore = useModelStore.getState()
        const assistantStore = useAssistantStore.getState()
        const promptStore = usePromptStore.getState()
        const conversationStore = useConversationStore.getState()

        // Load settings
        logger.info('Loading settings...')
        await settingsStore.loadSettings()

        // Load self user (needed for participant queries)
        logger.info('Loading self user...')
        await userStore.loadSelfUser()

        // Load models and providers first (assistants reference models)
        logger.info('Loading models and providers...')
        await modelStore.loadAll()

        // Load assistants (optional - users can use models directly)
        logger.info('Loading assistants...')
        await assistantStore.loadAssistants()

        // Load prompts
        logger.info('Loading prompts...')
        await promptStore.loadPrompts()

        // Load conversations
        logger.info('Loading conversations...')
        await conversationStore.loadConversations()

        // Check if onboarding is needed
        const onboardingComplete = await settingsStore.getSetting('onboarding_complete')
        const hasAssistants = assistantStore.assistants.length > 0

        if (onboardingComplete !== 'true' && !hasAssistants) {
          logger.info('[useAppInit] Triggering onboarding flow...')
          const onboardingStore = useOnboardingStore.getState()
          onboardingStore.setDialogOpen(true)
        }

        logger.info('App initialization complete')
      } catch (err) {
        logger.error('Failed to initialize app:', err)
        setError(String(err))
      } finally {
        setIsInitialized(true)
      }
    }

    initialize()
    // Empty deps - run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Set up inter-store communication callbacks (runs once on mount)
  useEffect(() => {
    const messageStore = useMessageStore.getState()
    const conversationStore = useConversationStore.getState()

    // When messageStore creates a new conversation, update conversationStore
    messageStore.onNewConversationCreated = (conversation) => {
      logger.info('[useAppInit] New conversation created via callback:', conversation.id)
      conversationStore.setCurrentConversation(conversation)
      // Also add to conversations list if not already there
      if (!conversationStore.conversations.find((c) => c.id === conversation.id)) {
        conversationStore.loadConversations()
      }
    }

    // Cleanup on unmount
    return () => {
      messageStore.onNewConversationCreated = undefined
    }
  }, [])

  // Once conversations are loaded, handle initial model/assistant selection
  useEffect(() => {
    const conversationStore = useConversationStore.getState()
    const modelStore = useModelStore.getState()

    if (conversations.length > 0 && !conversationStore.currentConversation) {
      // Case 1: Has conversation history - select the most recent conversation
      // The conversation's last joined model/assistant will be auto-selected by selectConversation
      logger.info(
        `[useAppInit] Found ${conversations.length} conversations, selecting most recent...`
      )
      const mostRecentConv = conversations[0] // Already sorted by updated_at DESC
      useConversationStore.getState().selectConversation(mostRecentConv.id)
      logger.info(
        '[useAppInit] Selected most recent conversation, last joined model/assistant will be used'
      )
    } else if (conversations.length === 0) {
      // No conversation history - determine default model selection
      logger.info('[useAppInit] No conversation history, determining default model...')
      const models = modelStore.models

      if (models.length === 0) {
        // Case 4: No models at all - don't select anything
        logger.info('[useAppInit] No models available, no selection')
      } else {
        const starredModels = models.filter((m: any) => m.is_starred)

        if (starredModels.length > 0) {
          // Case 2: Has starred models - select the last starred model
          const lastStarredModel = starredModels[starredModels.length - 1]
          logger.info('[useAppInit] Selecting last starred model:', lastStarredModel.name)
          conversationStore.setSelectedModel(lastStarredModel)
          // Mark as initialized since we've set a default
          useConversationStore.setState({ isFirstConversationSinceStartup: false })
        } else {
          // Case 3: No starred models - select the last added model
          const lastAddedModel = models[models.length - 1]
          logger.info(
            '[useAppInit] No starred models, selecting last added model:',
            lastAddedModel.name
          )
          conversationStore.setSelectedModel(lastAddedModel)
          // Mark as initialized since we've set a default
          useConversationStore.setState({ isFirstConversationSinceStartup: false })
        }
      }
    }
  }, [conversations])

  return { isInitialized, error }
}
