import { useCallback } from 'react'
import { useMessageStore } from '@/stores/message'
import { useMcpStore } from '@/stores/mcpStore'
import type { McpAuthRequiredEvent, PermissionRequestedEvent } from '../types'
import { usePermissionStore } from '@/stores/permissionStore'
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
  const handleMcpAuthRequired = useCallback((event: McpAuthRequiredEvent) => {
    logger.warn('[useToolCallHandlers] MCP auth required for server:', event.server_id)
    // Silent refresh already failed in the backend: surface the sign-in
    // prompt in this conversation, and probe for the OAuth discovery data
    // the re-authorize flow needs.
    useMcpStore.getState().reportNeedsAuth(event.conversation_id, event.server_id)
    useMcpStore.getState().probeEndpoint(event.server_id)
  }, [])

  const handlePermissionRequested = useCallback((request: PermissionRequestedEvent) => {
    logger.info('[useToolCallHandlers] Permission requested:', {
      conversation: request.conversation_id,
      tool: request.tool_name,
      subject: request.subject,
    })
    usePermissionStore.getState().show({
      requestId: request.request_id,
      conversationId: request.conversation_id,
      toolName: request.tool_name,
      subject: request.subject,
      tier: request.tier,
      grant: request.grant,
      warning: request.warning ?? null,
      remember: request.remember ?? null,
      escalation: request.escalation ?? null,
      escape: request.escape ?? null,
    })
  }, [])

  const handlePermissionResolved = useCallback((requestId: string) => {
    logger.info('[useToolCallHandlers] Permission resolved:', requestId)
    usePermissionStore.getState().remove(requestId)
  }, [])

  return {
    handleToolCallStarted,
    handleToolCallCompleted,
    handleMcpAuthRequired,
    handlePermissionRequested,
    handlePermissionResolved,
  }
}
