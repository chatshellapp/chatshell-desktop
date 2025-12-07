import { invoke } from '@tauri-apps/api/core'
import type { Message, Conversation } from '@/types'
import type { ImmerSet, StoreGet, MessageStoreCrudActions } from './types'
import { MAX_MESSAGES_IN_MEMORY } from './types'
import { cleanupThrottleState } from './throttle'

export const createCrudActions = (set: ImmerSet, get: StoreGet): MessageStoreCrudActions => ({
  loadMessages: async (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists

    // Update the state to loading
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.isLoading = true
      }
      draft.error = null
    })

    try {
      const messages = await invoke<Message[]>('list_messages_by_conversation', {
        conversationId,
      })
      // Limit messages in memory to prevent memory leaks
      const limitedMessages = messages.slice(-MAX_MESSAGES_IN_MEMORY)

      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.messages = limitedMessages
          convState.isLoading = false
        }
      })
    } catch (error) {
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.isLoading = false
        }
        draft.error = String(error)
      })
      console.error('Failed to load messages:', error)
    }
  },

  sendMessage: async (
    content: string,
    conversationId: string | null,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    includeHistory?: boolean,
    systemPrompt?: string,
    userPrompt?: string,
    modelDbId?: string,
    assistantDbId?: string,
    urlsToFetch?: string[],
    images?: { name: string; base64: string; mimeType: string }[],
    files?: { name: string; content: string; mimeType: string }[],
    searchEnabled?: boolean
  ) => {
    set((draft) => {
      draft.isSending = true
      draft.error = null
    })

    try {
      // If no conversationId, create a new conversation first
      let targetId = conversationId
      if (!targetId) {
        console.log('[messageStore] No conversation ID provided, creating new conversation...')
        const newConversation = await invoke<Conversation>('create_conversation', {
          req: { title: 'New Conversation' },
        })
        targetId = newConversation.id
        console.log('[messageStore] Created new conversation:', newConversation)

        // Notify via callback (avoids direct store coupling)
        const callback = get().onNewConversationCreated
        if (callback) {
          callback(newConversation)
        }
      }

      // Set waiting state for this conversation and clear previous streaming content
      get().getConversationState(targetId) // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[targetId]
        if (convState) {
          convState.isStreaming = true
          convState.isWaitingForAI = true
          convState.streamingContent = ''
          convState.streamingReasoningContent = '' // Clear previous reasoning content
        }
      })

      console.log('[messageStore] Invoking send_message command with params:', {
        conversationId: targetId,
        contentLength: content.length,
        provider,
        model,
        hasApiKey: !!apiKey,
        baseUrl,
        includeHistory,
        hasSystemPrompt: !!systemPrompt,
        hasUserPrompt: !!userPrompt,
        modelDbId,
        assistantDbId,
        hasImages: !!images?.length,
        hasFiles: !!files?.length,
        searchEnabled,
      })

      // This will return the user message immediately
      const userMessage = await invoke<Message>('send_message', {
        conversationId: targetId,
        content,
        provider,
        model,
        apiKey,
        baseUrl,
        includeHistory,
        systemPrompt,
        userPrompt,
        modelDbId,
        assistantDbId,
        urlsToFetch,
        images,
        files,
        searchEnabled,
      })

      console.log('[messageStore] Received user message:', userMessage)

      // Add user message to the conversation
      set((draft) => {
        const convState = draft.conversationStates[targetId]
        if (convState) {
          convState.messages.push(userMessage)
        }
        draft.isSending = false
      })

      console.log('[messageStore] User message added to store, waiting for assistant response...')

      // The assistant message will be added via the chat-complete event
    } catch (error) {
      console.error('[messageStore] Error in sendMessage:', error)
      console.error('[messageStore] Error type:', typeof error)
      console.error('[messageStore] Error details:', {
        error,
        errorString: String(error),
        errorKeys: error ? Object.keys(error) : 'null',
      })

      set((draft) => {
        draft.error = String(error)
        draft.isSending = false
      })
      throw error
    }
  },

  stopGeneration: async (conversationId: string) => {
    try {
      console.log('[messageStore] Stopping generation for conversation:', conversationId)
      await invoke('stop_generation', { conversationId })

      // Only reset sending flag
      set((draft) => {
        draft.isSending = false
      })

      console.log('[messageStore] Generation stopped successfully')
    } catch (error) {
      console.error('[messageStore] Failed to stop generation:', error)
    }
  },

  clearMessages: async (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists

    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.isLoading = true
      }
      draft.error = null
    })

    try {
      await invoke('clear_messages_by_conversation', { conversationId })

      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.messages = []
          convState.isLoading = false
        }
      })
    } catch (error) {
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.isLoading = false
        }
        draft.error = String(error)
      })
      throw error
    }
  },

  addMessage: (conversationId: string, message: Message) => {
    console.log('[messageStore] Adding message to conversation:', conversationId)
    get().getConversationState(conversationId) // Ensure state exists

    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        // Check if message already exists
        const existingIndex = convState.messages.findIndex((m: Message) => m.id === message.id)

        if (existingIndex >= 0) {
          // Replace existing message (idempotent behavior)
          console.log('[messageStore] Message exists, replacing:', message.id)
          convState.messages[existingIndex] = message
        } else {
          // Add new message
          convState.messages.push(message)
        }

        convState.isWaitingForAI = false
      }
    })
  },

  setAttachmentStatus: (
    conversationId: string,
    status: 'idle' | 'processing' | 'complete' | 'error'
  ) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.attachmentStatus = status
      }
    })
  },

  incrementAttachmentRefreshKey: (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.attachmentRefreshKey += 1
      }
    })
  },

  setApiError: (conversationId: string, error: string | null) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.apiError = error
        // Reset streaming states when error occurs
        convState.isStreaming = false
        convState.isWaitingForAI = false
        convState.streamingContent = ''
      }
    })
  },

  clearApiError: (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.apiError = null
      }
    })
  },

  cleanupConversation: (conversationId: string) => {
    // Clean up throttle state
    cleanupThrottleState(conversationId)

    // Reset streaming state for this conversation
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.streamingContent = ''
        convState.streamingReasoningContent = ''
        convState.isStreaming = false
        convState.isWaitingForAI = false
        convState.attachmentStatus = 'idle'
      }
    })
  },

  removeConversationState: (conversationId: string) => {
    // Clean up throttle state
    cleanupThrottleState(conversationId)

    // Completely remove conversation state from memory
    set((draft) => {
      delete draft.conversationStates[conversationId]
    })

    console.log('[messageStore] Removed conversation state for:', conversationId)
  },
})

