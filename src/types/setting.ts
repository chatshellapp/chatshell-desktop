// Settings type
export interface Setting {
  key: string
  value: string
  updated_at: string
}

// Search provider type
export interface SearchProvider {
  id: string
  name: string
}

// Known search provider IDs
export type SearchProviderId = 'duckduckgo' | 'yahoo' | 'baidu'

// Web Fetch types
export type WebFetchMode = 'local' | 'api'
export type WebFetchLocalMethod = 'auto' | 'fetch' | 'headless'
export type WebFetchApiProvider = 'jina'
