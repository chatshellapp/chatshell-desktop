// ==========================================================================
// CATEGORY 2: CONTEXT ENRICHMENTS (system-fetched content)
// ==========================================================================

// Search result - stores web search metadata only (no content in filesystem)
export interface SearchResult {
  id: string
  query: string
  engine: string // "google" | "bing" | "duckduckgo"
  total_results?: number
  searched_at: string
  created_at: string
}

export interface CreateSearchResultRequest {
  query: string
  engine: string
  total_results?: number
  searched_at: string
}

// Fetch result - stores fetched web resource metadata (content in filesystem)
// source_type="user_link" indicates a user-provided URL (no separate user_links table)
export interface FetchResult {
  id: string
  source_type: string // "search" | "user_link"
  source_id?: string // FK to search_results.id (only for source_type="search")
  url: string
  title?: string
  description?: string
  storage_path: string // Path relative to attachments dir: "fetch/{uuid}.md"
  content_type: string // MIME type of stored content: "text/markdown", "text/plain"
  original_mime?: string // Original MIME type from HTTP response
  status: string // "pending" | "processing" | "success" | "failed"
  error?: string
  keywords?: string
  headings?: string // JSON array of headings
  original_size?: number
  processed_size?: number
  favicon_url?: string
  created_at: string
  updated_at: string
}

export interface CreateFetchResultRequest {
  source_type?: string
  source_id?: string
  url: string
  title?: string
  description?: string
  storage_path: string
  content_type: string
  original_mime?: string
  status?: string
  error?: string
  keywords?: string
  headings?: string
  original_size?: number
  processed_size?: number
  favicon_url?: string
}

// Context enrichment type enum
export type ContextType = 'search_result' | 'fetch_result'

// Unified context enrichment type
export type ContextEnrichment =
  | ({ type: 'search_result' } & SearchResult)
  | ({ type: 'fetch_result' } & FetchResult)

// Helper type guards for context enrichments
export function isSearchResult(
  context: ContextEnrichment
): context is { type: 'search_result' } & SearchResult {
  return context.type === 'search_result'
}

export function isFetchResult(
  context: ContextEnrichment
): context is { type: 'fetch_result' } & FetchResult {
  return context.type === 'fetch_result'
}
