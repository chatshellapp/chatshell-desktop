// User types
export interface User {
  id: string
  username: string
  display_name: string
  email?: string
  avatar_type: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string
  is_self: boolean
  status: string // "active", "inactive", "deleted"
  last_seen_at?: string
  created_at: string
  updated_at: string
}

export interface CreateUserRequest {
  username: string
  display_name: string
  email?: string
  avatar_type?: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string
  is_self?: boolean
}

// User relationship types
export interface UserRelationship {
  id: string
  user_id: string
  related_user_id: string
  relationship_type: string // "friend", "blocked", "pending"
  created_at: string
  updated_at: string
}

export interface CreateUserRelationshipRequest {
  user_id: string
  related_user_id: string
  relationship_type: string
}

