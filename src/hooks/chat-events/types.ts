import type { PermissionGrant, PermissionWarning } from '@/stores/permissionStore'

// Local event types not exported from @/types

export interface ConversationUpdatedEvent {
  conversation_id: string
  title: string
}

export interface GenerationStoppedEvent {
  conversation_id: string
}

export interface ReasoningStartedEvent {
  conversation_id: string
}

export interface SearchDecisionStartedEvent {
  message_id: string
  conversation_id: string
}

// Tool call events for MCP
export interface ToolCallStartedEvent {
  conversation_id: string
  tool_call_id: string
  tool_name: string
  tool_input: string
}

export interface ToolCallCompletedEvent {
  conversation_id: string
  tool_call_id: string
  tool_name: string
  tool_input: string
  tool_output: string
}

export interface McpAuthRequiredEvent {
  conversation_id: string
  server_id: string
}

// Tool approval gate events
export interface PermissionRequestedEvent {
  conversation_id: string
  request_id: string
  tool_name: string
  subject: string
  tier: 'read' | 'write' | 'exec'
  grant: PermissionGrant | null
  /** Set when a classifier signal forced this prompt past session grants. */
  warning?: PermissionWarning | null
  /** Scope "remember on this device" would persist; null when not offered. */
  remember?: PermissionGrant | null
}

export interface PermissionResolvedEvent {
  request_id: string
}
