// Provider types
export interface Provider {
  id: string
  name: string
  provider_type: string // "ollama", "openai", "openrouter", "custom_openai", "custom_anthropic"
  api_key?: string
  base_url?: string
  api_style?: string // "responses" | "chat_completions" (only for custom_openai)
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
  api_style?: string
  description?: string
  is_enabled?: boolean
}
