// Conversation types
export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  last_message?: string
}

export interface CreateConversationRequest {
  title: string
}

// Conversation participant types
export interface ConversationParticipant {
  id: string
  conversation_id: string
  participant_type: string // "user", "model", "assistant"
  participant_id?: string
  display_name?: string
  role: string // "owner", "admin", "member", "observer"
  status: string // "active", "left", "removed", "invited"
  joined_at: string
  left_at?: string
  last_read_at?: string
  metadata?: string
}

export interface CreateConversationParticipantRequest {
  conversation_id: string
  participant_type: string
  participant_id?: string
  display_name?: string
}

// Participant summary for UI display
export interface ParticipantSummary {
  participant_type: string
  participant_id?: string
  display_name: string
  avatar_type: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string
}
