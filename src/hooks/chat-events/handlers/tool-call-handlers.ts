import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message'
import { logger } from '@/lib/logger'

/**
 * Handlers for MCP tool call events
 */
export function useToolCallHandlers() {
  const handleToolCallStarted = useCallback(
    (convId: string, toolCallId: string, toolName: string, toolInput: string) => {
      logger.info('[useToolCallHandlers] Tool call started:', {
        conversation: convId,
        toolCallId,
        toolName,
      })
      useMessageStore.getState().addStreamingToolCall(convId, toolCallId, toolName, toolInput)
    },
    []
  )

  const handleToolCallCompleted = useCallback(
    (convId: string, toolCallId: string, toolOutput: string) => {
      logger.info('[useToolCallHandlers] Tool call completed:', {
        conversation: convId,
        toolCallId,
        outputLength: toolOutput.length,
      })
      useMessageStore.getState().updateStreamingToolCall(convId, toolCallId, toolOutput)
    },
    []
  )

  return {
    handleToolCallStarted,
    handleToolCallCompleted,
  }
}
