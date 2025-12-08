import type { ModelParameterPreset } from './model-parameter-preset'

// ==========================================================================
// ASSISTANT - Model + System Prompt + Parameter Preset packaged together
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

  // Reference to parameter preset
  model_parameter_preset_id?: string

  // The full preset data (populated via JOIN)
  preset?: ModelParameterPreset

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

  // Reference to parameter preset (optional - will use default if not specified)
  model_parameter_preset_id?: string

  // Avatar
  avatar_type?: string
  avatar_bg?: string
  avatar_text?: string
  avatar_image_path?: string
  avatar_image_url?: string

  group_name?: string
  is_starred?: boolean
}
