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

