// Knowledge Base types
export interface KnowledgeBase {
  id: string
  name: string
  type: string // "document", "url", "file", "folder"
  content?: string
  url?: string
  metadata?: string
  created_at: string
  updated_at: string
}

export interface CreateKnowledgeBaseRequest {
  name: string
  type: string
  content?: string
  url?: string
  metadata?: string
}
