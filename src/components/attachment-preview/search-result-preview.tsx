import { useState, useEffect } from 'react'
import {
  Search,
  ChevronDown,
  ChevronUp,
  XCircle,
  CircleQuestionMark,
  CheckCircle2,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { SearchResult, FetchResult, SearchDecision } from '@/types'
import { SearchResultFetchItem, ProcessingUrlItem } from './fetch-result-preview'

// SearchResult preview component - expandable inline list
export function SearchResultPreview({
  searchResult,
  urlStatuses,
  messageId,
}: {
  searchResult: SearchResult
  urlStatuses?: Record<string, 'fetching' | 'fetched'>
  messageId?: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [fetchResults, setFetchResults] = useState<FetchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  // Track processing state - check if any URL is still fetching
  const hasUrlStatuses = urlStatuses && Object.keys(urlStatuses).length > 0
  const isProcessing = hasUrlStatuses && Object.values(urlStatuses).some((s) => s === 'fetching')

  // Check if search is still in progress (no total_results yet)
  const isSearching =
    searchResult.total_results === null || searchResult.total_results === undefined

  // Auto-expand when search results arrive
  useEffect(() => {
    if (!isSearching && searchResult.total_results && searchResult.total_results > 0) {
      setIsExpanded(true)
    }
  }, [isSearching, searchResult.total_results])

  // Count of fetched URLs - triggers reload when each one completes
  const fetchedCount = urlStatuses
    ? Object.values(urlStatuses).filter((s) => s === 'fetched').length
    : 0

  // Load linked fetch results - reload when any URL status changes to 'fetched'
  useEffect(() => {
    // Skip loading while still searching (no results yet) or no message ID
    if (isSearching || !messageId) {
      return
    }

    const loadResults = async () => {
      setLoading(true)
      try {
        // Query via message_contexts to correctly get deduplicated fetch results
        const results = await invoke<FetchResult[]>('get_fetch_results_by_message', {
          messageId: messageId,
        })
        setFetchResults(results)

        // If we expect results but got none and not processing, schedule a retry (up to 5 times)
        if (
          results.length === 0 &&
          searchResult.total_results &&
          searchResult.total_results > 0 &&
          retryCount < 5 &&
          !isProcessing
        ) {
          setTimeout(() => setRetryCount((c) => c + 1), 1000)
        }
      } catch (err) {
        console.error('Failed to load fetch results:', err)
        setFetchResults([])
      } finally {
        setLoading(false)
      }
    }

    loadResults()
  }, [
    messageId,
    searchResult.total_results,
    retryCount,
    isProcessing,
    isSearching,
    fetchedCount,
  ])

  const urlCount = urlStatuses ? Object.keys(urlStatuses).length : 0
  const resultCount = urlCount || fetchResults.length || searchResult.total_results || 0

  // Determine if expandable (has URL statuses or results)
  const canExpand = !isSearching && (resultCount > 0 || hasUrlStatuses)

  return (
    <div className="w-full rounded-lg border border-muted overflow-hidden">
      {/* Header row - similar style to FetchResultPreview */}
      <button
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors ${canExpand ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'}`}
      >
        <Search
          className={`h-4 w-4 text-muted-foreground flex-shrink-0 ${isSearching ? 'animate-pulse' : ''}`}
        />

        {isSearching ? (
          <span className="flex-1 text-sm text-muted-foreground">Searching the web</span>
        ) : (
          <>
            <span className="flex-1 text-sm truncate">{searchResult.query}</span>

            <span className="text-sm text-muted-foreground flex-shrink-0 flex items-center gap-1.5">
              {loading ? (
                'Loading...'
              ) : (
                <>
                  {`${resultCount} results`}
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              )}
            </span>
          </>
        )}
      </button>

      {/* Expandable results list */}
      {isExpanded && canExpand && (
        <div className="border-t border-muted divide-y divide-muted">
          {/* Show URLs with their status (during processing) */}
          {hasUrlStatuses &&
            Object.entries(urlStatuses).map(([url, status]) => {
              if (status === 'fetching') {
                return <ProcessingUrlItem key={url} url={url} />
              }
              // For fetched URLs, find and show the actual fetch result
              const fetchResult = fetchResults.find((r) => r.url === url)
              if (fetchResult) {
                return <SearchResultFetchItem key={fetchResult.id} fetchResult={fetchResult} />
              }
              // Fallback if result not yet loaded (brief transition state)
              return <ProcessingUrlItem key={url} url={url} />
            })}
          {/* Show fetch results after processing is complete (no URL statuses) */}
          {!hasUrlStatuses &&
            fetchResults.map((result) => (
              <SearchResultFetchItem key={result.id} fetchResult={result} />
            ))}
          {/* Loading state when no URL statuses and no results */}
          {!hasUrlStatuses && fetchResults.length === 0 && loading && (
            <p className="text-sm text-muted-foreground px-3 py-2">Loading search results...</p>
          )}
          {/* Empty state */}
          {!hasUrlStatuses && fetchResults.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground px-3 py-2">No results fetched yet.</p>
          )}
        </div>
      )}
    </div>
  )
}

// SearchDecision preview component - shows AI reasoning for search decision
export function SearchDecisionPreview({ decision }: { decision: SearchDecision }) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="w-full rounded-lg border border-muted overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
      >
        {decision.search_needed ? (
          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
        )}

        <span className="flex-1 text-sm truncate">
          {decision.search_needed ? 'Search needed' : 'No search needed'}
        </span>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground flex-shrink-0">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {/* Expandable reasoning */}
      {isExpanded && (
        <div className="border-t border-muted px-3 py-3 space-y-3">
          {/* Reasoning */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Reasoning
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed">{decision.reasoning}</p>
          </div>

          {/* Search query if search was needed */}
          {decision.search_needed && decision.search_query && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Search Query
              </p>
              <p className="text-sm text-foreground/80 leading-relaxed">{decision.search_query}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Pending SearchDecision preview - shown while AI is deciding
export function PendingSearchDecisionPreview() {
  return (
    <div className="w-full rounded-lg border border-muted overflow-hidden">
      <div className="flex items-center gap-2.5 w-full px-3 py-2.5">
        <CircleQuestionMark className="h-4 w-4 text-muted-foreground flex-shrink-0 animate-pulse" />
        <span className="flex-1 text-sm text-muted-foreground">
          Deciding if web search is needed...
        </span>
      </div>
    </div>
  )
}

