import { invoke } from '@tauri-apps/api/core'
import type {
  Conversation,
  CreateConversationRequest,
  ConversationParticipant,
  CreateConversationParticipantRequest,
  Assistant,
  Model,
} from '@/types'
import type { ImmerSet, StoreGet, ConversationStoreActions } from './types'
import { logger } from '@/lib/logger'
import { uuidv7 } from '@/lib/uuid'

// Shared in-flight save so a double send cannot insert the draft twice
let savingDraft: Promise<void> | null = null

// A conversation without its own model/assistant participant continues with
// whatever was used last
function selectLastUsed(set: ImmerSet, get: StoreGet) {
  const state = get()
  // Only use lastUsedModel if it's not soft-deleted
  if (state.lastUsedModel && !state.lastUsedModel.is_deleted) {
    get().setSelectedModel(state.lastUsedModel)
    logger.info(
      '[conversationStore] No participant found, using lastUsedModel:',
      state.lastUsedModel.name
    )
  } else if (state.lastUsedAssistant) {
    get().setSelectedAssistant(state.lastUsedAssistant)
    logger.info(
      '[conversationStore] No participant found, using lastUsedAssistant:',
      state.lastUsedAssistant.name
    )
  } else {
    // Only clear if we have no lastUsed either
    set((draft) => {
      draft.selectedModel = null
      draft.selectedAssistant = null
    })
    logger.info('[conversationStore] No model/assistant found, cleared selection')
  }
}

export const createActions = (set: ImmerSet, get: StoreGet): ConversationStoreActions => ({
  loadConversations: async () => {
    set((draft) => {
      draft.isLoading = true
      draft.error = null
    })
    try {
      const conversations = await invoke<Conversation[]>('list_conversations')
      logger.info('[conversationStore] Loaded conversations:', conversations)
      set((draft) => {
        draft.conversations = conversations
        draft.isLoading = false
      })
    } catch (error) {
      set((draft) => {
        draft.error = String(error)
        draft.isLoading = false
      })
      logger.error('Failed to load conversations:', error)
    }
  },

  createConversation: async (title: string) => {
    set((draft) => {
      draft.isLoading = true
      draft.error = null
    })
    try {
      const req: CreateConversationRequest = { title }
      const conversation = await invoke<Conversation>('create_conversation', { req })
      logger.info('[conversationStore] Created conversation:', conversation)

      set((draft) => {
        draft.conversations.unshift(conversation)
        draft.isLoading = false
      })

      return conversation
    } catch (error) {
      set((draft) => {
        draft.error = String(error)
        draft.isLoading = false
      })
      throw error
    }
  },

  updateConversation: async (id: string, title: string) => {
    set((draft) => {
      draft.isLoading = true
      draft.error = null
    })
    try {
      const conversation = await invoke<Conversation>('update_conversation', { id, title })
      set((draft) => {
        const index = draft.conversations.findIndex((c: Conversation) => c.id === id)
        if (index >= 0) {
          draft.conversations[index] = conversation
        }
        if (draft.currentConversation?.id === id) {
          draft.currentConversation = conversation
        }
        draft.isLoading = false
      })
      return conversation
    } catch (error) {
      set((draft) => {
        draft.error = String(error)
        draft.isLoading = false
      })
      throw error
    }
  },

  deleteConversation: async (id: string) => {
    set((draft) => {
      draft.isLoading = true
      draft.error = null
    })
    try {
      await invoke('delete_conversation', { id })

      // Clean up message store state for this conversation
      const { useMessageStore } = await import('../message')
      useMessageStore.getState().removeConversationState(id)

      // Clean up conversation settings from cache
      const { useConversationSettingsStore } = await import('../conversationSettingsStore')
      useConversationSettingsStore.getState().removeSettings(id)

      set((draft) => {
        draft.conversations = draft.conversations.filter((c: Conversation) => c.id !== id)
        if (draft.currentConversation?.id === id) {
          draft.currentConversation = null
        }
        draft.isLoading = false
      })
    } catch (error) {
      set((draft) => {
        draft.error = String(error)
        draft.isLoading = false
      })
      throw error
    }
  },

  openDraftConversation: async () => {
    const existing = get().draftConversation
    if (existing && get().currentConversation?.id === existing.id) {
      return existing
    }

    const now = new Date().toISOString()
    const draftConversation: Conversation = {
      id: uuidv7(),
      title: '',
      created_at: now,
      updated_at: now,
    }
    const previousDraftId = existing?.id
    set((draft) => {
      draft.draftConversation = draftConversation
      draft.currentConversation = draftConversation
      draft.currentParticipants = []
    })
    selectLastUsed(set, get)

    const { useConversationSettingsStore } = await import('../conversationSettingsStore')
    const settingsStore = useConversationSettingsStore.getState()
    if (previousDraftId) {
      settingsStore.removeSettings(previousDraftId)
    }
    await settingsStore.startDraft(draftConversation.id)
    logger.info('[conversationStore] Opened draft conversation:', draftConversation.id)
    return draftConversation
  },

  saveDraftConversation: async (id: string) => {
    const draftConversation = get().draftConversation
    if (draftConversation?.id === id && !savingDraft) {
      savingDraft = (async () => {
        const req: CreateConversationRequest = { id, title: draftConversation.title }
        const conversation = await invoke<Conversation>('create_conversation', { req })
        logger.info('[conversationStore] Saved draft conversation:', conversation.id)
        set((draft) => {
          draft.draftConversation = null
          draft.conversations.unshift(conversation)
          if (draft.currentConversation?.id === id) {
            draft.currentConversation = conversation
          }
        })
      })().finally(() => {
        savingDraft = null
      })
    }
    if (savingDraft) {
      await savingDraft
    }

    // Separate from the insert so a failed settings write is retried on the next send
    const { useConversationSettingsStore } = await import('../conversationSettingsStore')
    await useConversationSettingsStore.getState().persistDraft(id)
  },

  selectConversation: async (id: string) => {
    // A draft has no database row to load; it is already in memory
    if (id === get().draftConversation?.id) return

    try {
      // Don't cleanup here - preserve streaming state across conversation switches
      // The streaming state is now tracked per conversation ID

      const conversation = await invoke<Conversation | null>('get_conversation', { id })
      logger.info('[conversationStore] Selected conversation:', conversation)

      if (conversation) {
        const abandonedDraftId = get().draftConversation?.id
        set((draft) => {
          draft.currentConversation = conversation
          draft.draftConversation = null
        })
        // Load participants for this conversation
        await get().loadParticipants(id)

        // Load conversation settings from database
        const { useConversationSettingsStore } = await import('../conversationSettingsStore')
        if (abandonedDraftId) {
          useConversationSettingsStore.getState().removeSettings(abandonedDraftId)
        }
        await useConversationSettingsStore.getState().loadSettings(id)

        // Set selected model/assistant based on conversation participants (select the LAST joined one)
        const participants = get().currentParticipants
        const modelOrAssistantParticipants = participants.filter(
          (p) => p.participant_type === 'model' || p.participant_type === 'assistant'
        )
        const modelOrAssistantParticipant =
          modelOrAssistantParticipants.length > 0
            ? modelOrAssistantParticipants[modelOrAssistantParticipants.length - 1]
            : null

        if (modelOrAssistantParticipant) {
          // Import stores dynamically to avoid circular dependencies
          const { useModelStore } = await import('../modelStore')
          const { useAssistantStore } = await import('../assistantStore')

          if (
            modelOrAssistantParticipant.participant_type === 'model' &&
            modelOrAssistantParticipant.participant_id
          ) {
            const model = useModelStore
              .getState()
              .getModelById(modelOrAssistantParticipant.participant_id)
            // Only select if model exists and is not soft-deleted
            if (model && !model.is_deleted) {
              get().setSelectedModel(model)
              logger.info('[conversationStore] Set selected model from conversation:', model.name)
            } else if (model?.is_deleted) {
              logger.info('[conversationStore] Model is soft-deleted, not selecting:', model.name)
              set((draft) => {
                draft.selectedModel = null
                draft.selectedAssistant = null
              })
            }
          } else if (
            modelOrAssistantParticipant.participant_type === 'assistant' &&
            modelOrAssistantParticipant.participant_id
          ) {
            const assistant = useAssistantStore
              .getState()
              .assistants.find(
                (a: Assistant) => a.id === modelOrAssistantParticipant.participant_id
              )
            if (assistant) {
              get().setSelectedAssistant(assistant)
              logger.info(
                '[conversationStore] Set selected assistant from conversation:',
                assistant.name
              )
            }
          }
        } else {
          // No participants yet - use lastUsed model/assistant to maintain continuity
          selectLastUsed(set, get)
        }

        // When no model/assistant is selected, reset tools/skills to global defaults
        // to prevent stale assistant-specific settings from persisting after restart
        if (!get().selectedModel && !get().selectedAssistant) {
          await useConversationSettingsStore.getState().resetToolsAndSkillsToGlobal(id)
        }
      } else {
        set((draft) => {
          draft.currentConversation = null
          draft.currentParticipants = []
        })
      }
    } catch (error) {
      logger.error('Failed to select conversation:', error)
      set((draft) => {
        draft.error = String(error)
      })
    }
  },

  setCurrentConversation: (conversation: Conversation | null) => {
    // Don't cleanup here - preserve streaming state across conversation switches
    // The streaming state is now tracked per conversation ID
    set((draft) => {
      draft.currentConversation = conversation
    })
  },

  setPendingInput: (input: string | null) => {
    set((draft) => {
      draft.pendingInput = input
    })
  },

  loadParticipants: async (conversationId: string) => {
    try {
      const participants = await invoke<ConversationParticipant[]>(
        'list_conversation_participants',
        { conversationId }
      )
      logger.info('[conversationStore] Loaded participants:', participants)
      set((draft) => {
        draft.currentParticipants = participants
      })
    } catch (error) {
      logger.error('Failed to load participants:', error)
      set((draft) => {
        draft.error = String(error)
      })
    }
  },

  addParticipant: async (
    conversationId: string,
    participantType: string,
    participantId?: string,
    displayName?: string
  ) => {
    try {
      const req: CreateConversationParticipantRequest = {
        conversation_id: conversationId,
        participant_type: participantType,
        participant_id: participantId,
        display_name: displayName,
      }
      const participant = await invoke<ConversationParticipant>('add_conversation_participant', {
        req,
      })
      logger.info('[conversationStore] Added participant:', participant)

      set((draft) => {
        draft.currentParticipants.push(participant)
      })
    } catch (error) {
      logger.error('Failed to add participant:', error)
      set((draft) => {
        draft.error = String(error)
      })
      throw error
    }
  },

  removeParticipant: async (participantId: string) => {
    try {
      await invoke('remove_conversation_participant', { id: participantId })
      set((draft) => {
        draft.currentParticipants = draft.currentParticipants.filter(
          (p: ConversationParticipant) => p.id !== participantId
        )
      })
    } catch (error) {
      logger.error('Failed to remove participant:', error)
      set((draft) => {
        draft.error = String(error)
      })
      throw error
    }
  },

  setSelectedModel: (model: Model | null) => {
    // Don't allow selecting soft-deleted models
    if (model?.is_deleted) {
      logger.info('[conversationStore] Refusing to select soft-deleted model:', model.name)
      return
    }
    logger.info('[conversationStore] Setting selected model:', model?.name)
    set((draft) => {
      draft.selectedModel = model
      draft.selectedAssistant = null
      draft.lastUsedModel = model
      draft.lastUsedAssistant = null
    })
  },

  setSelectedAssistant: (assistant: Assistant | null) => {
    logger.info('[conversationStore] Setting selected assistant:', assistant?.name)
    set((draft) => {
      draft.selectedAssistant = assistant
      draft.selectedModel = null
      draft.lastUsedAssistant = assistant
      draft.lastUsedModel = null
    })
  },

  bumpConversation: (id: string, lastMessage?: string) => {
    set((draft) => {
      const index = draft.conversations.findIndex((c: Conversation) => c.id === id)
      if (index < 0) return
      // Update even when already on top: the first message is what makes a
      // blank conversation appear in the sidebar list
      const conversation = draft.conversations[index]
      conversation.updated_at = new Date().toISOString()
      if (lastMessage !== undefined) {
        conversation.last_message = lastMessage
      }
      if (index > 0) {
        draft.conversations.splice(index, 1)
        draft.conversations.unshift(conversation)
      }
    })
  },
})
