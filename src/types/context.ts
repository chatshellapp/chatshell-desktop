// Context enrichment types are generated from Rust models (src-tauri/src/models/context.rs)
// via ts-rs. Run `pnpm types:generate` in src-tauri to regenerate.

export type { SearchResult } from './generated/SearchResult'
export type { CreateSearchResultRequest } from './generated/CreateSearchResultRequest'
export type { FetchResult } from './generated/FetchResult'
export type { CreateFetchResultRequest } from './generated/CreateFetchResultRequest'
export type { ContextType } from './generated/ContextType'
export type { ContextEnrichment } from './generated/ContextEnrichment'

import type { ContextEnrichment } from './generated/ContextEnrichment'
import type { SearchResult } from './generated/SearchResult'
import type { FetchResult } from './generated/FetchResult'

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
