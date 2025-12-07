// Message types (thinking_content moved to ThinkingStep)
export interface Message {
  id: string
  conversation_id?: string
  sender_type: string
  sender_id?: string
  content: string
  tokens?: number
  created_at: string
}

export interface CreateMessageRequest {
  conversation_id?: string
  sender_type: string
  sender_id?: string
  content: string
  tokens?: number
}

