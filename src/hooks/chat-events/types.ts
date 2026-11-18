import type {
  PermissionEscalation,
  PermissionEscape,
  PermissionGrant,
  PermissionWarning,
} from '@/stores/permissionStore'

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
  /** User-visible server name (absent from older payloads). */
  server_name?: string
}

/** Server progress for an in-flight MCP tool call. */
export interface McpToolProgressEvent {
  conversation_id: string
  server_name: string
  /** Display key of the tool-call card (`mcp__<server>__<tool>`). */
  tool_name: string
  progress: number
  total?: number | null
  message?: string | null
}

/** A server asks the user for input during a call (FR-12). */
export interface McpElicitationRequestedEvent {
  request_id: string
  server_name: string
  mode: 'form' | 'url'
  message: string
  schema?: import('@/stores/elicitationStore').ElicitationSchema
  url?: string
}

/** A server reported a tool list change; the backend already re-listed. */
export interface McpToolsChangedEvent {
  server_id: string
  server_name: string
  tool_count: number
}

/** MCP servers that connected for a send (clears needs-sign-in state). */
export interface McpServersConnectedEvent {
  conversation_id: string
  server_ids: string[]
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
  /** Set for sandbox escalation cards. */
  escalation?: PermissionEscalation | null
  /** Jailed bash: what approving widens for this one execution. */
  escape?: PermissionEscape | null
}

export interface PermissionResolvedEvent {
  request_id: string
}
