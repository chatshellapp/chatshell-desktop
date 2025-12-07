// Tool types
export interface Tool {
  id: string
  name: string
  type: string // "server", "tool", "api"
  endpoint?: string
  config?: string
  description?: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface CreateToolRequest {
  name: string
  type: string
  endpoint?: string
  config?: string
  description?: string
  is_enabled?: boolean
}

