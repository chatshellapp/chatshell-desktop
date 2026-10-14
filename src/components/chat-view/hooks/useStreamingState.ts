import { useMessageStore, type MessageStore } from '@/stores/message'
import type { StreamingToolCall } from '@/components/attachment-preview/tool-call-preview'

const EMPTY_TOOL_CALLS: Record<string, StreamingToolCall> = {}
const EMPTY_IMAGES: string[] = []
const EMPTY_PENDING_DECISIONS: Record<string, boolean> = {}

/**
 * High-frequency streaming state (per-throttled-token content, reasoning,
 * tool calls, images). Subscribed ONLY by the streaming message row so that
 * per-token updates re-render that row alone, never the history list
 * (streaming isolation invariant).
 */
export function useStreamingState(conversationId: string | null) {
  const conv = (state: MessageStore) =>
    conversationId ? state.conversationStates[conversationId] : undefined

  const streamingContent = useMessageStore((state) => conv(state)?.streamingContent ?? '')
  const streamingReasoningContent = useMessageStore(
    (state) => conv(state)?.streamingReasoningContent ?? ''
  )
  const isReasoningActive = useMessageStore((state) => conv(state)?.isReasoningActive ?? false)
  const isWaitingForAI = useMessageStore((state) => conv(state)?.isWaitingForAI ?? false)
  const isStreaming = useMessageStore((state) => conv(state)?.isStreaming ?? false)
  const streamingToolCalls = useMessageStore(
    (state) => conv(state)?.streamingToolCalls ?? EMPTY_TOOL_CALLS
  )
  const streamingImages = useMessageStore((state) => conv(state)?.streamingImages ?? EMPTY_IMAGES)
  const pendingSearchDecisions = useMessageStore(
    (state) => conv(state)?.pendingSearchDecisions ?? EMPTY_PENDING_DECISIONS
  )

  return {
    streamingContent,
    streamingReasoningContent,
    isReasoningActive,
    isWaitingForAI,
    isStreaming,
    streamingToolCalls,
    streamingImages,
    pendingSearchDecisions,
  }
}
