export interface MessageSearchResult {
  message_id: string
  conversation_id: string
  conversation_title?: string
  sender_type: string
  content_snippet: string
  created_at: string
}

export interface ConversationSearchResult {
  id: string
  title: string
  updated_at: string
  last_message?: string
}

export interface SearchResults {
  messages: MessageSearchResult[]
  conversations: ConversationSearchResult[]
  total_message_count: number
  search_time_ms: number
}
