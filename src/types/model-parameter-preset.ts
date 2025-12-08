// Model Parameter Preset types
export interface ModelParameterPreset {
  id: string
  name: string
  description?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  additional_params?: Record<string, unknown>
  is_system: boolean
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface CreateModelParameterPresetRequest {
  name: string
  description?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  additional_params?: Record<string, unknown>
  is_default?: boolean
}

export interface UpdateModelParameterPresetRequest {
  name?: string
  description?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  additional_params?: Record<string, unknown>
  is_default?: boolean
}

