// Prompt types
export interface Prompt {
  id: string
  name: string
  content: string
  description?: string
  category?: string
  is_system: boolean
  is_starred: boolean
  created_at: string
  updated_at: string
}

export interface CreatePromptRequest {
  name: string
  content: string
  description?: string
  category?: string
  is_system?: boolean
}
