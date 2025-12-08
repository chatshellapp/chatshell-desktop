import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import type {
  ChatStreamEvent,
  ChatStreamReasoningEvent,
  ChatCompleteEvent,
  ChatErrorEvent,
  AttachmentProcessingStartedEvent,
  AttachmentProcessingCompleteEvent,
  AttachmentProcessingErrorEvent,
  AttachmentUpdateEvent,
  SearchDecisionCompleteEvent,
} from '@/types'
import type {
  ConversationUpdatedEvent,
  GenerationStoppedEvent,
  ReasoningStartedEvent,
  SearchDecisionStartedEvent,
} from './types'
import { logger } from '@/lib/logger'
import {
  useChatHandlers,
  useAttachmentHandlers,
  useSearchDecisionHandlers,
  useConversationHandlers,
} from './handlers'

export function useChatEvents(conversationId: string | null) {
  const conversationIdRef = useRef(conversationId)

  // Update ref when conversationId changes
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  // Get handlers from separated hooks
  const {
    handleStreamChunk,
    handleStreamReasoningChunk,
    handleChatComplete,
    handleChatError,
    handleReasoningStarted,
  } = useChatHandlers()

  const {
    handleAttachmentProcessingStarted,
    handleAttachmentProcessingComplete,
    handleAttachmentProcessingError,
    handleAttachmentUpdate,
  } = useAttachmentHandlers()

  const { handleSearchDecisionStarted, handleSearchDecisionComplete } = useSearchDecisionHandlers()

  const { handleConversationUpdated, handleGenerationStopped } = useConversationHandlers()

  useEffect(() => {
    if (!conversationId) return

    logger.info('[useChatEvents] Setting up event listeners for conversation:', conversationId)

    // Listen for streaming chunks
    const unlistenStream = listen<ChatStreamEvent>('chat-stream', (event) => {
      logger.info('[useChatEvents] Received chat-stream event:', event.payload)
      logger.info(
        '[useChatEvents] Event conversation_id:',
        event.payload.conversation_id,
        'Current:',
        conversationIdRef.current
      )
      // Process the event for the specific conversation (no need to check if it's current)
      handleStreamChunk(event.payload.conversation_id, event.payload.content)
    })

    // Listen for streaming reasoning/thinking content (from models like GPT-5, Gemini)
    const unlistenStreamReasoning = listen<ChatStreamReasoningEvent>(
      'chat-stream-reasoning',
      (event) => {
        logger.info('[useChatEvents] Received chat-stream-reasoning event:', event.payload)
        handleStreamReasoningChunk(event.payload.conversation_id, event.payload.content)
      }
    )

    // Listen for chat completion
    const unlistenComplete = listen<ChatCompleteEvent>('chat-complete', (event) => {
      logger.info('[useChatEvents] Received chat-complete event:', event.payload)
      logger.info(
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
      logger.info('[useChatEvents] Received chat-error event:', event.payload)
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

    // Listen for search decision complete (AI has finished deciding if search is needed)
    const unlistenSearchDecisionComplete = listen<SearchDecisionCompleteEvent>(
      'search-decision-complete',
      (event) => {
        logger.info('[useChatEvents] Received search-decision-complete event:', event.payload)
        handleSearchDecisionComplete(event.payload.conversation_id, event.payload.message_id)
      }
    )

    // Listen for conversation updates (title changes)
    const unlistenConversationUpdated = listen<ConversationUpdatedEvent>(
      'conversation-updated',
      (event) => {
        logger.info('[useChatEvents] Received conversation-updated event:', event.payload)
        handleConversationUpdated(event.payload.conversation_id, event.payload.title)
      }
    )

    // Listen for generation stopped
    const unlistenGenerationStopped = listen<GenerationStoppedEvent>(
      'generation-stopped',
      (event) => {
        logger.info('[useChatEvents] Received generation-stopped event:', event.payload)
        handleGenerationStopped(event.payload.conversation_id)
      }
    )

    // Listen for reasoning started (AI begins thinking)
    const unlistenReasoningStarted = listen<ReasoningStartedEvent>('reasoning-started', (event) => {
      logger.info('[useChatEvents] Received reasoning-started event:', event.payload)
      handleReasoningStarted(event.payload.conversation_id)
    })

    // Cleanup listeners when component unmounts or conversationId changes
    return () => {
      logger.info('[useChatEvents] Cleaning up event listeners for conversation:', conversationId)
      unlistenStream.then((fn) => fn())
      unlistenStreamReasoning.then((fn) => fn())
      unlistenComplete.then((fn) => fn())
      unlistenChatError.then((fn) => fn())
      unlistenAttachmentStarted.then((fn) => fn())
      unlistenAttachmentComplete.then((fn) => fn())
      unlistenAttachmentError.then((fn) => fn())
      unlistenAttachmentUpdate.then((fn) => fn())
      unlistenSearchDecisionStarted.then((fn) => fn())
      unlistenSearchDecisionComplete.then((fn) => fn())
      unlistenConversationUpdated.then((fn) => fn())
      unlistenGenerationStopped.then((fn) => fn())
      unlistenReasoningStarted.then((fn) => fn())
    }
  }, [
    conversationId,
    handleStreamChunk,
    handleStreamReasoningChunk,
    handleChatComplete,
    handleChatError,
    handleAttachmentProcessingStarted,
    handleAttachmentProcessingComplete,
    handleAttachmentProcessingError,
    handleAttachmentUpdate,
    handleSearchDecisionStarted,
    handleSearchDecisionComplete,
    handleConversationUpdated,
    handleGenerationStopped,
    handleReasoningStarted,
  ])
}
