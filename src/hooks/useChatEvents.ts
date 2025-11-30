import { useEffect, useCallback, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useMessageStore } from '@/stores/messageStore'
import { useConversationStore } from '@/stores/conversationStore'
import type {
  ChatStreamEvent,
  ChatCompleteEvent,
  ChatErrorEvent,
  AttachmentProcessingStartedEvent,
  AttachmentProcessingCompleteEvent,
  AttachmentProcessingErrorEvent,
  AttachmentUpdateEvent,
} from '@/types'

interface ConversationUpdatedEvent {
  conversation_id: string
  title: string
}

interface GenerationStoppedEvent {
  conversation_id: string
}

interface SearchDecisionStartedEvent {
  message_id: string
  conversation_id: string
}

export function useChatEvents(conversationId: string | null) {
  const conversationIdRef = useRef(conversationId)

  // Update ref when conversationId changes
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  // Create stable callback references using useCallback
  // These now take conversationId as parameter
  const handleStreamChunk = useCallback((convId: string, chunk: string) => {
    console.log('[useChatEvents] Appending chunk to conversation:', convId)
    useMessageStore.getState().appendStreamingChunk(convId, chunk)
  }, [])

  const handleChatComplete = useCallback((convId: string, message: any) => {
    console.log(
      '[useChatEvents] handleChatComplete called for conversation:',
      convId,
      'message:',
      message
    )
    const store = useMessageStore.getState()
    const convState = store.getConversationState(convId)
    console.log(
      '[useChatEvents] Current messages count for conversation:',
      convState.messages.length
    )
    store.addMessage(convId, message)
    console.log(
      '[useChatEvents] After addMessage, messages count:',
      store.getConversationState(convId).messages.length
    )
    store.setIsStreaming(convId, false)
    store.setStreamingContent(convId, '')
  }, [])

  const handleAttachmentProcessingStarted = useCallback(
    (convId: string, messageId: string, urls: string[]) => {
      const store = useMessageStore.getState()
      store.setAttachmentStatus(convId, 'processing')
      store.setUrlStatuses(convId, messageId, urls)
    },
    []
  )

  const handleAttachmentProcessingComplete = useCallback((convId: string, messageId: string) => {
    const store = useMessageStore.getState()
    store.setAttachmentStatus(convId, 'complete')
    store.clearUrlStatuses(convId, messageId)
  }, [])

  const handleAttachmentProcessingError = useCallback((convId: string, error: string) => {
    useMessageStore.getState().setAttachmentStatus(convId, 'error')
    console.error('Attachment processing error:', error)
  }, [])

  const handleAttachmentUpdate = useCallback(
    (convId: string, messageId?: string, completedUrl?: string) => {
      const store = useMessageStore.getState()
      // Mark the completed URL as fetched
      if (messageId && completedUrl) {
        store.markUrlFetched(convId, messageId, completedUrl)
      }
      // Trigger a refresh by incrementing the refresh key
      store.incrementAttachmentRefreshKey(convId)
      // Clear pending search decision when actual decision arrives
      if (messageId) {
        store.setPendingSearchDecision(convId, messageId, false)
      }
    },
    []
  )

  const handleConversationUpdated = useCallback((conversationId: string, title: string) => {
    console.log('[useChatEvents] Conversation title updated:', conversationId, title)
    const conversationStore = useConversationStore.getState()

    // Update the conversation in the list
    const updatedConversations = conversationStore.conversations.map((conv) =>
      conv.id === conversationId ? { ...conv, title } : conv
    )

    // Update the store
    useConversationStore.setState({ conversations: updatedConversations })

    // If it's the current conversation, update that too
    if (conversationStore.currentConversation?.id === conversationId) {
      useConversationStore.setState({
        currentConversation: { ...conversationStore.currentConversation, title },
      })
    }
  }, [])

  const handleGenerationStopped = useCallback((convId: string) => {
    console.log('[useChatEvents] Generation stopped for conversation:', convId)
    // Reset streaming states when generation is stopped
    // This is needed when stopping before any content arrives,
    // as chat-complete event won't be emitted in that case
    const store = useMessageStore.getState()
    store.setIsStreaming(convId, false)
    store.setIsWaitingForAI(convId, false)
    store.setStreamingContent(convId, '')
  }, [])

  const handleSearchDecisionStarted = useCallback((convId: string, messageId: string) => {
    console.log('[useChatEvents] Search decision started for message:', messageId)
    const store = useMessageStore.getState()
    store.setPendingSearchDecision(convId, messageId, true)
  }, [])

  const handleChatError = useCallback((convId: string, error: string) => {
    console.log('[useChatEvents] handleChatError called for conversation:', convId, 'error:', error)
    const store = useMessageStore.getState()
    store.setApiError(convId, error)
  }, [])

  useEffect(() => {
    if (!conversationId) return

    console.log('[useChatEvents] Setting up event listeners for conversation:', conversationId)

    // Listen for streaming chunks
    const unlistenStream = listen<ChatStreamEvent>('chat-stream', (event) => {
      console.log('[useChatEvents] Received chat-stream event:', event.payload)
      console.log(
        '[useChatEvents] Event conversation_id:',
        event.payload.conversation_id,
        'Current:',
        conversationIdRef.current
      )
      // Process the event for the specific conversation (no need to check if it's current)
      handleStreamChunk(event.payload.conversation_id, event.payload.content)
    })

    // Listen for chat completion
    const unlistenComplete = listen<ChatCompleteEvent>('chat-complete', (event) => {
      console.log('[useChatEvents] Received chat-complete event:', event.payload)
      console.log(
        '[useChatEvents] Event conversation_id:',
        event.payload.conversation_id,
        'Current:',
        conversationIdRef.current
      )
      // Process the event for the specific conversation (no need to check if it's current)
      handleChatComplete(event.payload.conversation_id, event.payload.message)
    })

    // Listen for chat errors (API failures)
    const unlistenChatError = listen<ChatErrorEvent>('chat-error', (event) => {
      console.log('[useChatEvents] Received chat-error event:', event.payload)
      handleChatError(event.payload.conversation_id, event.payload.error)
    })

    // Listen for attachment processing started
    const unlistenAttachmentStarted = listen<AttachmentProcessingStartedEvent>(
      'attachment-processing-started',
      (event) => {
        handleAttachmentProcessingStarted(
          event.payload.conversation_id,
          event.payload.message_id,
          event.payload.urls
        )
      }
    )

    // Listen for attachment processing complete
    const unlistenAttachmentComplete = listen<AttachmentProcessingCompleteEvent>(
      'attachment-processing-complete',
      (event) => {
        handleAttachmentProcessingComplete(event.payload.conversation_id, event.payload.message_id)
      }
    )

    // Listen for attachment processing errors
    const unlistenAttachmentError = listen<AttachmentProcessingErrorEvent>(
      'attachment-processing-error',
      (event) => {
        handleAttachmentProcessingError(event.payload.conversation_id, event.payload.error)
      }
    )

    // Listen for attachment updates (new attachments added)
    const unlistenAttachmentUpdate = listen<AttachmentUpdateEvent>('attachment-update', (event) => {
      handleAttachmentUpdate(
        event.payload.conversation_id,
        event.payload.message_id,
        event.payload.completed_url
      )
    })

    // Listen for search decision started (AI is deciding if search is needed)
    const unlistenSearchDecisionStarted = listen<SearchDecisionStartedEvent>(
      'search-decision-started',
      (event) => {
        handleSearchDecisionStarted(event.payload.conversation_id, event.payload.message_id)
      }
    )

    // Listen for conversation updates (title changes)
    const unlistenConversationUpdated = listen<ConversationUpdatedEvent>(
      'conversation-updated',
      (event) => {
        console.log('[useChatEvents] Received conversation-updated event:', event.payload)
        handleConversationUpdated(event.payload.conversation_id, event.payload.title)
      }
    )

    // Listen for generation stopped
    const unlistenGenerationStopped = listen<GenerationStoppedEvent>(
      'generation-stopped',
      (event) => {
        console.log('[useChatEvents] Received generation-stopped event:', event.payload)
        handleGenerationStopped(event.payload.conversation_id)
      }
    )

    // Cleanup listeners when component unmounts or conversationId changes
    return () => {
      console.log('[useChatEvents] Cleaning up event listeners for conversation:', conversationId)
      unlistenStream.then((fn) => fn())
      unlistenComplete.then((fn) => fn())
      unlistenChatError.then((fn) => fn())
      unlistenAttachmentStarted.then((fn) => fn())
      unlistenAttachmentComplete.then((fn) => fn())
      unlistenAttachmentError.then((fn) => fn())
      unlistenAttachmentUpdate.then((fn) => fn())
      unlistenSearchDecisionStarted.then((fn) => fn())
      unlistenConversationUpdated.then((fn) => fn())
      unlistenGenerationStopped.then((fn) => fn())
    }
  }, [
    conversationId,
    handleStreamChunk,
    handleChatComplete,
    handleChatError,
    handleAttachmentProcessingStarted,
    handleAttachmentProcessingComplete,
    handleAttachmentProcessingError,
    handleAttachmentUpdate,
    handleSearchDecisionStarted,
    handleConversationUpdated,
    handleGenerationStopped,
  ])
}
