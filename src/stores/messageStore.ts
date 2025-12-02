import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Message, Conversation } from '@/types'

// Per-conversation state
interface ConversationState {
  messages: Message[]
  isLoading: boolean
  isStreaming: boolean
  streamingContent: string
  // Streaming reasoning/thinking content from models like GPT-5, Gemini with thinking
  streamingReasoningContent: string
  isWaitingForAI: boolean
  attachmentStatus: 'idle' | 'processing' | 'complete' | 'error'
  // Counter that increments to force attachment refresh
  attachmentRefreshKey: number
  // Track URL fetch statuses for each message: { messageId: { url: status } }
  urlStatuses: Record<string, Record<string, 'fetching' | 'fetched'>>
  // Track pending search decisions per message: { messageId: true/false }
  pendingSearchDecisions: Record<string, boolean>
  // API error state - shown when LLM request fails
  apiError: string | null
}

// Default state for a new conversation
const createDefaultConversationState = (): ConversationState => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: '',
  streamingReasoningContent: '',
  isWaitingForAI: false,
  attachmentStatus: 'idle',
  attachmentRefreshKey: 0,
  urlStatuses: {},
  pendingSearchDecisions: {},
  apiError: null,
})

interface MessageStore {
  // Record of conversationId -> state
  conversationStates: Record<string, ConversationState>

  // Global states
  isSending: boolean
  error: string | null

  // Callback for inter-store communication (avoids direct store imports)
  onNewConversationCreated?: (conversation: Conversation) => void

  // Get state for specific conversation (creates if doesn't exist)
  getConversationState: (conversationId: string) => ConversationState

  // Actions with conversationId
  loadMessages: (conversationId: string) => Promise<void>
  sendMessage: (
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
  ) => Promise<void>
  stopGeneration: (conversationId: string) => Promise<void>
  clearMessages: (conversationId: string) => Promise<void>
  addMessage: (conversationId: string, message: Message) => void
  setStreamingContent: (conversationId: string, content: string) => void
  setIsStreaming: (conversationId: string, isStreaming: boolean) => void
  setAttachmentStatus: (
    conversationId: string,
    status: 'idle' | 'processing' | 'complete' | 'error'
  ) => void
  incrementAttachmentRefreshKey: (conversationId: string) => void
  setUrlStatuses: (conversationId: string, messageId: string, urls: string[]) => void
  markUrlFetched: (conversationId: string, messageId: string, url: string) => void
  clearUrlStatuses: (conversationId: string, messageId: string) => void
  appendStreamingChunk: (conversationId: string, chunk: string) => void
  appendStreamingReasoningChunk: (conversationId: string, chunk: string) => void
  setIsWaitingForAI: (conversationId: string, isWaiting: boolean) => void
  setPendingSearchDecision: (conversationId: string, messageId: string, pending: boolean) => void
  setApiError: (conversationId: string, error: string | null) => void
  clearApiError: (conversationId: string) => void
  cleanupConversation: (conversationId: string) => void
  removeConversationState: (conversationId: string) => void
}

// Throttling mechanism for streaming updates
const pendingChunks: Map<string, string[]> = new Map()
const updateScheduled: Map<string, boolean> = new Map()
const updateTimeoutIds: Map<string, NodeJS.Timeout> = new Map()
const THROTTLE_MS = 50 // Update UI every 50ms for smooth rendering

// Separate throttling for reasoning content
const pendingReasoningChunks: Map<string, string[]> = new Map()
const reasoningUpdateScheduled: Map<string, boolean> = new Map()
const reasoningUpdateTimeoutIds: Map<string, NodeJS.Timeout> = new Map()

// Maximum messages to keep in memory to prevent memory leaks
const MAX_MESSAGES_IN_MEMORY = 100

export const useMessageStore = create<MessageStore>()(
  immer((set, get) => ({
    conversationStates: {},
    isSending: false,
    error: null,
    onNewConversationCreated: undefined,

    getConversationState: (conversationId: string) => {
      const state = get()
      let convState = state.conversationStates[conversationId]

      if (!convState) {
        // Create new state for this conversation
        convState = createDefaultConversationState()
        set((draft) => {
          draft.conversationStates[conversationId] = convState!
        })
      }

      return convState
    },

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
          // Check if message already exists (Entity Adapter pattern from Cherry Studio)
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

    setStreamingContent: (conversationId: string, content: string) => {
      get().getConversationState(conversationId) // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.streamingContent = content
          // When clearing streaming content, also clear reasoning content
          if (content === '') {
            convState.streamingReasoningContent = ''
          }
        }
      })
    },

    setIsStreaming: (conversationId: string, isStreaming: boolean) => {
      get().getConversationState(conversationId) // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.isStreaming = isStreaming
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

    setUrlStatuses: (conversationId: string, messageId: string, urls: string[]) => {
      get().getConversationState(conversationId) // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          // Initialize all URLs with 'fetching' status
          convState.urlStatuses[messageId] = urls.reduce(
            (acc, url) => {
              acc[url] = 'fetching'
              return acc
            },
            {} as Record<string, 'fetching' | 'fetched'>
          )
        }
      })
    },

    markUrlFetched: (conversationId: string, messageId: string, url: string) => {
      get().getConversationState(conversationId)
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState && convState.urlStatuses[messageId]) {
          convState.urlStatuses[messageId][url] = 'fetched'
        }
      })
    },

    clearUrlStatuses: (conversationId: string, messageId: string) => {
      get().getConversationState(conversationId) // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          delete convState.urlStatuses[messageId]
        }
      })
    },

    appendStreamingChunk: (conversationId: string, chunk: string) => {
      // Initialize arrays for this conversation if needed
      if (!pendingChunks.has(conversationId)) {
        pendingChunks.set(conversationId, [])
      }
      if (!updateScheduled.has(conversationId)) {
        updateScheduled.set(conversationId, false)
      }

      pendingChunks.get(conversationId)!.push(chunk)

      if (!updateScheduled.get(conversationId)) {
        updateScheduled.set(conversationId, true)

        // Clear any existing timeout to prevent leaks
        const existingTimeout = updateTimeoutIds.get(conversationId)
        if (existingTimeout !== undefined) {
          clearTimeout(existingTimeout)
        }

        // Use setTimeout for consistent throttling
        const timeoutId = setTimeout(() => {
          get().getConversationState(conversationId) // Ensure state exists
          const chunks = pendingChunks.get(conversationId) || []
          const allChunks = chunks.join('')
          pendingChunks.set(conversationId, [])
          updateScheduled.set(conversationId, false)
          updateTimeoutIds.delete(conversationId)

          set((draft) => {
            const convState = draft.conversationStates[conversationId]
            if (convState) {
              convState.streamingContent = convState.streamingContent + allChunks
              convState.isWaitingForAI = false
            }
          })
        }, THROTTLE_MS)

        updateTimeoutIds.set(conversationId, timeoutId)
      }
    },

    appendStreamingReasoningChunk: (conversationId: string, chunk: string) => {
      // Initialize arrays for this conversation if needed
      if (!pendingReasoningChunks.has(conversationId)) {
        pendingReasoningChunks.set(conversationId, [])
      }
      if (!reasoningUpdateScheduled.has(conversationId)) {
        reasoningUpdateScheduled.set(conversationId, false)
      }

      pendingReasoningChunks.get(conversationId)!.push(chunk)

      if (!reasoningUpdateScheduled.get(conversationId)) {
        reasoningUpdateScheduled.set(conversationId, true)

        // Clear any existing timeout to prevent leaks
        const existingTimeout = reasoningUpdateTimeoutIds.get(conversationId)
        if (existingTimeout !== undefined) {
          clearTimeout(existingTimeout)
        }

        // Use setTimeout for consistent throttling
        const timeoutId = setTimeout(() => {
          get().getConversationState(conversationId) // Ensure state exists
          const chunks = pendingReasoningChunks.get(conversationId) || []
          const allChunks = chunks.join('')
          pendingReasoningChunks.set(conversationId, [])
          reasoningUpdateScheduled.set(conversationId, false)
          reasoningUpdateTimeoutIds.delete(conversationId)

          set((draft) => {
            const convState = draft.conversationStates[conversationId]
            if (convState) {
              convState.streamingReasoningContent = convState.streamingReasoningContent + allChunks
              convState.isWaitingForAI = false
            }
          })
        }, THROTTLE_MS)

        reasoningUpdateTimeoutIds.set(conversationId, timeoutId)
      }
    },

    setIsWaitingForAI: (conversationId: string, isWaiting: boolean) => {
      get().getConversationState(conversationId) // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.isWaitingForAI = isWaiting
        }
      })
    },

    setPendingSearchDecision: (conversationId: string, messageId: string, pending: boolean) => {
      get().getConversationState(conversationId) // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          if (pending) {
            convState.pendingSearchDecisions[messageId] = true
          } else {
            delete convState.pendingSearchDecisions[messageId]
          }
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
      // Clear any pending timeouts for this conversation (text)
      const timeoutId = updateTimeoutIds.get(conversationId)
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        updateTimeoutIds.delete(conversationId)
      }

      // Clear any pending timeouts for reasoning
      const reasoningTimeoutId = reasoningUpdateTimeoutIds.get(conversationId)
      if (reasoningTimeoutId !== undefined) {
        clearTimeout(reasoningTimeoutId)
        reasoningUpdateTimeoutIds.delete(conversationId)
      }

      // Clear pending chunks
      pendingChunks.delete(conversationId)
      updateScheduled.delete(conversationId)
      pendingReasoningChunks.delete(conversationId)
      reasoningUpdateScheduled.delete(conversationId)

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
      // Clear any pending timeouts for this conversation (text)
      const timeoutId = updateTimeoutIds.get(conversationId)
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        updateTimeoutIds.delete(conversationId)
      }

      // Clear any pending timeouts for reasoning
      const reasoningTimeoutId = reasoningUpdateTimeoutIds.get(conversationId)
      if (reasoningTimeoutId !== undefined) {
        clearTimeout(reasoningTimeoutId)
        reasoningUpdateTimeoutIds.delete(conversationId)
      }

      // Clear pending chunks
      pendingChunks.delete(conversationId)
      updateScheduled.delete(conversationId)
      pendingReasoningChunks.delete(conversationId)
      reasoningUpdateScheduled.delete(conversationId)

      // Completely remove conversation state from memory
      set((draft) => {
        delete draft.conversationStates[conversationId]
      })

      console.log('[messageStore] Removed conversation state for:', conversationId)
    },
  }))
)
