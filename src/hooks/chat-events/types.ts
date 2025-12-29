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
