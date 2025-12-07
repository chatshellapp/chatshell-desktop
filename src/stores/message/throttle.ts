// Throttling mechanism for streaming updates
export const THROTTLE_MS = 50 // Update UI every 50ms for smooth rendering

// Content streaming throttle state
export const pendingChunks: Map<string, string[]> = new Map()
export const updateScheduled: Map<string, boolean> = new Map()
export const updateTimeoutIds: Map<string, NodeJS.Timeout> = new Map()

// Reasoning content streaming throttle state
export const pendingReasoningChunks: Map<string, string[]> = new Map()
export const reasoningUpdateScheduled: Map<string, boolean> = new Map()
export const reasoningUpdateTimeoutIds: Map<string, NodeJS.Timeout> = new Map()

// Cleanup all throttle state for a conversation
export function cleanupThrottleState(conversationId: string): void {
  // Clear content streaming state
  const timeoutId = updateTimeoutIds.get(conversationId)
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId)
    updateTimeoutIds.delete(conversationId)
  }
  pendingChunks.delete(conversationId)
  updateScheduled.delete(conversationId)

  // Clear reasoning streaming state
  const reasoningTimeoutId = reasoningUpdateTimeoutIds.get(conversationId)
  if (reasoningTimeoutId !== undefined) {
    clearTimeout(reasoningTimeoutId)
    reasoningUpdateTimeoutIds.delete(conversationId)
  }
  pendingReasoningChunks.delete(conversationId)
  reasoningUpdateScheduled.delete(conversationId)
}

