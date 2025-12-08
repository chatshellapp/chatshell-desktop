// ==========================================================================
// ASSISTANT - Model + Parameters + System Prompt packaged together
// ==========================================================================

// Assistant types
export interface Assistant {
  id: string
  name: string
  role?: string
  description?: string
  system_prompt: string
  user_prompt?: string
  model_id: string // Foreign key to models table

  // Model parameters (flattened in JSON for backward compatibility)
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  additional_params?: Record<string, unknown>

  // Avatar
  avatar_type: string // "text" or "image"
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string

  group_name?: string
  is_starred: boolean
  created_at: string
  updated_at: string
}

export interface CreateAssistantRequest {
  name: string
  role?: string
  description?: string
  system_prompt: string
  user_prompt?: string
  model_id: string // Foreign key to models table

  // Model parameters (flattened in JSON for backward compatibility)
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  additional_params?: Record<string, unknown>

  // Avatar
  avatar_type?: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string

  group_name?: string
  is_starred?: boolean
}
