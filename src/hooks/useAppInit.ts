import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useConversationStore } from '@/stores/conversation'
import { useMessageStore } from '@/stores/message'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore } from '@/stores/userStore'
import { usePromptStore } from '@/stores/promptStore'
import { useMcpStore } from '@/stores/mcpStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useAttachmentBlobStore } from '@/stores/attachmentBlobStore'
import { logger } from '@/lib/logger'
import { pickDefaultModel } from '@/lib/model-setup'

export function useAppInit() {
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keychainAvailable, setKeychainAvailable] = useState(true)

  // Use selectors only for reactive state (conversations/models)
  const conversations = useConversationStore((state) => state.conversations)
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const models = useModelStore((state) => state.models)

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

        // Load MCP servers and probe connections in background
        logger.info('Loading MCP servers...')
        useMcpStore.getState().loadServers()

        // Check keychain availability
        try {
          const available = await invoke<boolean>('is_keychain_available')
          setKeychainAvailable(available)
          if (!available) {
            logger.warn('Keychain access denied, API keys will not persist across restarts')
          }
        } catch (err) {
          logger.warn('Failed to check keychain availability:', err)
        }

        // Check if onboarding is needed. Assistants are no longer part of
        // the flow's completion semantics — they are optional personas the
        // user can create anytime from the sidebar.
        const onboardingComplete = await settingsStore.getSetting('onboarding_complete')

        if (onboardingComplete !== 'true') {
          logger.info('[useAppInit] Triggering onboarding flow...')
          const onboardingStore = useOnboardingStore.getState()
          // The sync-enable card is the flow's final step (ADR 04 §7);
          // suppress the standalone launch-time sync dialog for this
          // session so the two never stack.
          onboardingStore.markFlowOwnsSyncOffer()
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
  }, [])

  // Reload stores when a sync pass merged remote rows (runs once on mount)
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    listen<number>('sync-merged', () => {
      logger.info('Sync merged remote rows, reloading conversation list')
      useConversationStore
        .getState()
        .loadConversations()
        .catch((err) => {
          logger.error('Failed to reload conversations after sync:', err)
        })
      // Self-heal (plan §5): the merge may have brought previously-gone
      // attachment blobs into the container - re-run the open conversation's
      // fetch pass.
      useAttachmentBlobStore
        .getState()
        .refreshAfterMerge()
        .catch((err) => {
          logger.error('Attachment blob self-heal failed:', err)
        })
    })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch((err) => {
        logger.error('Failed to subscribe to sync-merged events:', err)
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // Set up inter-store communication callbacks (runs once on mount)
  useEffect(() => {
    const messageStore = useMessageStore.getState()
    const conversationStore = useConversationStore.getState()

    // When messageStore creates a new conversation, update conversationStore
    messageStore.onNewConversationCreated = async (conversation) => {
      logger.info('[useAppInit] New conversation created via callback:', conversation.id)
      // Use selectConversation to ensure settings are loaded
      await conversationStore.selectConversation(conversation.id)
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
      const defaultModel = pickDefaultModel(modelStore.models)

      if (!defaultModel) {
        // Case 4: No models at all - don't select anything
        logger.info('[useAppInit] No models available, no selection')
      } else {
        logger.info('[useAppInit] Selecting default model:', defaultModel.name)
        conversationStore.setSelectedModel(defaultModel)
        // Mark as initialized since we've set a default
        useConversationStore.setState({ isFirstConversationSinceStartup: false })
      }
    }
  }, [conversations])

  // Models can appear after initialization (a provider was configured in
  // Settings). Without this the composer stayed on "Select model or
  // assistant" with the textarea disabled even though models existed.
  useEffect(() => {
    if (!currentConversation) return
    const conversationStore = useConversationStore.getState()
    if (conversationStore.selectedModel || conversationStore.selectedAssistant) return
    const defaultModel = pickDefaultModel(models)
    if (!defaultModel) return
    logger.info('[useAppInit] Auto-selected default model after catalog change:', defaultModel.name)
    conversationStore.setSelectedModel(defaultModel)
    useConversationStore.setState({ isFirstConversationSinceStartup: false })
  }, [models, currentConversation])

  return { isInitialized, error, keychainAvailable }
}
