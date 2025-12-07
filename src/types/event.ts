import type { Message } from './message'

// Event payloads
export interface ChatStreamEvent {
  conversation_id: string
  content: string
}

// Event for streaming reasoning/thinking content (from models like GPT-5, Gemini with thinking)
export interface ChatStreamReasoningEvent {
  conversation_id: string
  content: string
}

export interface ChatCompleteEvent {
  conversation_id: string
  message: Message
}

export interface ChatErrorEvent {
  conversation_id: string
  error: string
}

export interface AttachmentProcessingStartedEvent {
  message_id: string
  conversation_id: string
  urls: string[]
}

export interface AttachmentProcessingCompleteEvent {
  message_id: string
  conversation_id: string
  attachment_ids: string[]
}

export interface AttachmentProcessingErrorEvent {
  message_id: string
  conversation_id: string
  attachment_id?: string
  error: string
}

export interface AttachmentUpdateEvent {
  message_id: string
  conversation_id: string
  completed_url?: string
  attachment?: {
    type: string
    id: string
    [key: string]: unknown
  }
}

export interface SearchDecisionCompleteEvent {
  message_id: string
  conversation_id: string
}

