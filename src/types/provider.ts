// Provider types
export interface Provider {
  id: string
  name: string
  provider_type: string // "ollama", "openai", "openrouter"
  api_key?: string
  base_url?: string
  description?: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface CreateProviderRequest {
  name: string
  provider_type: string
  api_key?: string
  base_url?: string
  description?: string
  is_enabled?: boolean
}
