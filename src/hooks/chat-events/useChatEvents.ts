import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import type {
  ChatStreamEvent,
  ChatStreamReasoningEvent,
  ChatStreamImageEvent,
  ChatCompleteEvent,
  ChatWarningEvent,
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
  McpAuthRequiredEvent,
  PermissionRequestedEvent,
  PermissionResolvedEvent,
  ReasoningStartedEvent,
  SearchDecisionStartedEvent,
  ToolCallStartedEvent,
  ToolCallCompletedEvent,
} from './types'
import { usePermissionStore } from '@/stores/permissionStore'
import { useAutoReviewStore, type AutoReviewDecidedEvent } from '@/stores/autoReviewStore'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { logger } from '@/lib/logger'
import {
  useChatHandlers,
  useAttachmentHandlers,
  useSearchDecisionHandlers,
  useConversationHandlers,
  useToolCallHandlers,
} from './handlers'

/**
 * App-wide subscription to the backend's chat events. Mount it once, above
 * anything that changes with the selected conversation: every event carries
 * its conversation_id and is routed into that conversation's store state, so
 * background runs keep receiving their chunks and completions. Subscribing
 * per selected conversation dropped events emitted while the listeners were
 * being swapped (or while the chat view was unmounted), which left a
 * finished run stuck in the streaming state.
 */
export function useChatEvents() {
  // Get handlers from separated hooks
  const {
    handleStreamChunk,
    handleStreamReasoningChunk,
    handleChatComplete,
    handleChatError,
    handleChatWarning,
    handleReasoningStarted,
    handleStreamImage,
  } = useChatHandlers()

  const {
    handleAttachmentProcessingStarted,
    handleAttachmentProcessingComplete,
    handleAttachmentProcessingError,
    handleAttachmentUpdate,
  } = useAttachmentHandlers()

  const { handleSearchDecisionStarted, handleSearchDecisionComplete } = useSearchDecisionHandlers()

  const { handleConversationUpdated, handleGenerationStopped } = useConversationHandlers()

  const {
    handleToolCallStarted,
    handleToolCallCompleted,
    handleMcpAuthRequired,
    handlePermissionRequested,
    handlePermissionResolved,
  } = useToolCallHandlers()

  // Listeners are registered once; they read the latest handlers through
  // this ref so a handler identity change (e.g. a language switch) never
  // re-subscribes and opens a window in which events are lost.
  const handlers = {
    handleStreamChunk,
    handleStreamReasoningChunk,
    handleChatComplete,
    handleChatError,
    handleChatWarning,
    handleReasoningStarted,
    handleStreamImage,
    handleAttachmentProcessingStarted,
    handleAttachmentProcessingComplete,
    handleAttachmentProcessingError,
    handleAttachmentUpdate,
    handleSearchDecisionStarted,
    handleSearchDecisionComplete,
    handleConversationUpdated,
    handleGenerationStopped,
    handleToolCallStarted,
    handleToolCallCompleted,
    handleMcpAuthRequired,
    handlePermissionRequested,
    handlePermissionResolved,
  }
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const h = () => handlersRef.current
    logger.info('[useChatEvents] Setting up app-wide chat event listeners')

    // Listen for streaming chunks
    const unlistenStream = listen<ChatStreamEvent>('chat-stream', (event) => {
      logger.info('[useChatEvents] Received chat-stream event', event.payload)
      h().handleStreamChunk(event.payload.conversation_id, event.payload.content)
    })

    // Listen for streaming reasoning/thinking content (from models like GPT-5, Gemini)
    const unlistenStreamReasoning = listen<ChatStreamReasoningEvent>(
      'chat-stream-reasoning',
      (event) => {
        logger.info('[useChatEvents] Received chat-stream-reasoning event:', event.payload)
        h().handleStreamReasoningChunk(event.payload.conversation_id, event.payload.content)
      }
    )

    // Listen for streaming generated images
    const unlistenStreamImage = listen<ChatStreamImageEvent>('chat-stream-image', (event) => {
      logger.info('[useChatEvents] Received chat-stream-image event:', event.payload)
      h().handleStreamImage(event.payload.conversation_id, event.payload.image_url)
    })

    // Listen for chat completion
    const unlistenComplete = listen<ChatCompleteEvent>('chat-complete', (event) => {
      logger.info('[useChatEvents] Received chat-complete event', event.payload)
      h().handleChatComplete(
        event.payload.conversation_id,
        event.payload.message,
        event.payload.error
      )
    })

    // Listen for chat errors (API failures)
    const unlistenChatError = listen<ChatErrorEvent>('chat-error', (event) => {
      logger.info('[useChatEvents] Received chat-error event:', event.payload)
      h().handleChatError(event.payload.conversation_id, event.payload.error)
    })

    // Listen for non-fatal chat warnings (e.g. images stripped from a
    // text-only model's direct input)
    const unlistenChatWarning = listen<ChatWarningEvent>('chat-warning', (event) => {
      logger.info('[useChatEvents] Received chat-warning event:', event.payload)
      h().handleChatWarning(
        event.payload.conversation_id,
        event.payload.warning,
        event.payload.images
      )
    })

    // Listen for attachment processing started
    const unlistenAttachmentStarted = listen<AttachmentProcessingStartedEvent>(
      'attachment-processing-started',
      (event) => {
        h().handleAttachmentProcessingStarted(
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
        h().handleAttachmentProcessingComplete(
          event.payload.conversation_id,
          event.payload.message_id
        )
      }
    )

    // Listen for attachment processing errors
    const unlistenAttachmentError = listen<AttachmentProcessingErrorEvent>(
      'attachment-processing-error',
      (event) => {
        h().handleAttachmentProcessingError(event.payload.conversation_id, event.payload.error)
      }
    )

    // Listen for attachment updates (new attachments added)
    const unlistenAttachmentUpdate = listen<AttachmentUpdateEvent>('attachment-update', (event) => {
      h().handleAttachmentUpdate(
        event.payload.conversation_id,
        event.payload.message_id,
        event.payload.completed_url
      )
    })

    // Listen for search decision started (AI is deciding if search is needed)
    const unlistenSearchDecisionStarted = listen<SearchDecisionStartedEvent>(
      'search-decision-started',
      (event) => {
        h().handleSearchDecisionStarted(event.payload.conversation_id, event.payload.message_id)
      }
    )

    // Listen for search decision complete (AI has finished deciding if search is needed)
    const unlistenSearchDecisionComplete = listen<SearchDecisionCompleteEvent>(
      'search-decision-complete',
      (event) => {
        logger.info('[useChatEvents] Received search-decision-complete event:', event.payload)
        h().handleSearchDecisionComplete(event.payload.conversation_id, event.payload.message_id)
      }
    )

    // Listen for conversation updates (title changes)
    const unlistenConversationUpdated = listen<ConversationUpdatedEvent>(
      'conversation-updated',
      (event) => {
        logger.info('[useChatEvents] Received conversation-updated event:', event.payload)
        h().handleConversationUpdated(event.payload.conversation_id, event.payload.title)
      }
    )

    // Listen for generation stopped
    const unlistenGenerationStopped = listen<GenerationStoppedEvent>(
      'generation-stopped',
      (event) => {
        logger.info('[useChatEvents] Received generation-stopped event:', event.payload)
        // Approvals of the stopped conversation are closed backend-side;
        // other conversations' pending approvals must stay answerable.
        usePermissionStore.getState().clearConversation(event.payload.conversation_id)
        h().handleGenerationStopped(event.payload.conversation_id)
      }
    )

    // Listen for reasoning started (AI begins thinking)
    const unlistenReasoningStarted = listen<ReasoningStartedEvent>('reasoning-started', (event) => {
      logger.info('[useChatEvents] Received reasoning-started event:', event.payload)
      h().handleReasoningStarted(event.payload.conversation_id)
    })

    // Listen for MCP tool call started
    const unlistenToolCallStarted = listen<ToolCallStartedEvent>('tool-call-started', (event) => {
      logger.info('[useChatEvents] Received tool-call-started event:', event.payload)
      h().handleToolCallStarted(
        event.payload.conversation_id,
        event.payload.tool_call_id,
        event.payload.tool_name,
        event.payload.tool_input
      )
    })

    // Listen for MCP tool call completed
    const unlistenToolCallCompleted = listen<ToolCallCompletedEvent>(
      'tool-call-completed',
      (event) => {
        logger.info('[useChatEvents] Received tool-call-completed event:', event.payload)
        h().handleToolCallCompleted(
          event.payload.conversation_id,
          event.payload.tool_call_id,
          event.payload.tool_output
        )
      }
    )

    // Listen for MCP auth required (token expired, 401 from tool call)
    const unlistenMcpAuthRequired = listen<McpAuthRequiredEvent>('mcp-auth-required', (event) => {
      logger.warn('[useChatEvents] Received mcp-auth-required event:', event.payload)
      h().handleMcpAuthRequired(event.payload.server_id)
    })

    // Listen for tool approval requests (permission gate, ask mode)
    const unlistenPermissionRequested = listen<PermissionRequestedEvent>(
      'permission-requested',
      (event) => {
        logger.info('[useChatEvents] Received permission-requested event:', event.payload)
        h().handlePermissionRequested(event.payload)
      }
    )

    // Auto-mode judgments: transcript markers, and the one-time suggestion
    // to switch modes after repeated denials (never aborts the turn)
    const unlistenAutoReview = listen<AutoReviewDecidedEvent>('auto-review-decided', (event) => {
      useAutoReviewStore.getState().receive(event.payload)
      if (event.payload.suggest_mode_switch) {
        toast.info(i18n.t('chat:autoReview.suggestModeSwitch'), { duration: 12000 })
      }
    })

    // Backend-closed approvals (timeout / stream end): dismiss the dialog
    const unlistenPermissionResolved = listen<PermissionResolvedEvent>(
      'permission-resolved',
      (event) => {
        h().handlePermissionResolved(event.payload.request_id)
      }
    )

    return () => {
      logger.info('[useChatEvents] Cleaning up app-wide chat event listeners')
      unlistenStream.then((fn) => fn())
      unlistenStreamReasoning.then((fn) => fn())
      unlistenStreamImage.then((fn) => fn())
      unlistenComplete.then((fn) => fn())
      unlistenChatError.then((fn) => fn())
      unlistenChatWarning.then((fn) => fn())
      unlistenAttachmentStarted.then((fn) => fn())
      unlistenAttachmentComplete.then((fn) => fn())
      unlistenAttachmentError.then((fn) => fn())
      unlistenAttachmentUpdate.then((fn) => fn())
      unlistenSearchDecisionStarted.then((fn) => fn())
      unlistenSearchDecisionComplete.then((fn) => fn())
      unlistenConversationUpdated.then((fn) => fn())
      unlistenGenerationStopped.then((fn) => fn())
      unlistenReasoningStarted.then((fn) => fn())
      unlistenToolCallStarted.then((fn) => fn())
      unlistenToolCallCompleted.then((fn) => fn())
      unlistenMcpAuthRequired.then((fn) => fn())
      unlistenPermissionRequested.then((fn) => fn())
      unlistenPermissionResolved.then((fn) => fn())
      unlistenAutoReview.then((fn) => fn())
    }
  }, [])
}
