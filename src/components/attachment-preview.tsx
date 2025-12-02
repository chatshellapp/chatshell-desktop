import { useState, useMemo, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Globe,
  ExternalLink,
  AlertTriangle,
  FileText,
  Image,
  FileIcon as FileIconLucide,
  ChevronDown,
  ChevronUp,
  Search,
  XCircle,
  CircleQuestionMark,
  CheckCircle2,
  Lightbulb,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from '@/components/markdown-content'
import type {
  UserAttachment,
  ContextEnrichment,
  ProcessStep,
  FetchResult,
  SearchResult,
  FileAttachment,
  SearchDecision,
} from '@/types'

/** Image data for lightbox navigation - supports both storage paths and base64 data */
export interface ImageAttachmentData {
  id: string
  fileName: string
  /** Storage path for persisted images (loaded via Tauri) */
  storagePath?: string
  /** Base64 data URL for in-memory images (e.g., data:image/png;base64,...) */
  base64?: string
}

interface AttachmentPreviewProps {
  /** User attachment (files, user links) */
  userAttachment?: UserAttachment
  /** Context enrichment (search results, fetch results) */
  context?: ContextEnrichment
  /** Process step (thinking, search decision, tool call, code execution) */
  step?: ProcessStep
  /** URL being processed (for loading state) */
  processingUrl?: string
  /** URL fetch statuses for search results: { url: 'fetching' | 'fetched' } */
  urlStatuses?: Record<string, 'fetching' | 'fetched'>
  /** Show pending search decision state (AI is deciding if search is needed) */
  pendingSearchDecision?: boolean
  /** All image attachments for lightbox navigation (only used when attachment is an image) */
  allImages?: ImageAttachmentData[]
  /** Current image index in allImages array */
  currentImageIndex?: number
}

// Extract domain from URL
function getDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return url
  }
}

// Get favicon URL for a fetch result
function getFaviconUrl(fetchResult: FetchResult): string {
  // First try to use the stored favicon_url
  if (fetchResult.favicon_url) {
    return fetchResult.favicon_url
  }

  // Fallback to Google favicon service
  try {
    const urlObj = new URL(fetchResult.url)
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`
  } catch {
    return ''
  }
}

// FetchResult preview component
function FetchResultPreview({ fetchResult }: { fetchResult: FetchResult }) {
  const [faviconError, setFaviconError] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)

  const faviconUrl = useMemo(() => getFaviconUrl(fetchResult), [fetchResult])
  const domain = getDomain(fetchResult.url)
  const title = fetchResult.title || domain
  const isFailed = fetchResult.status === 'failed'

  // Load content from filesystem when dialog opens
  useEffect(() => {
    if (isDialogOpen && !content && !loadingContent && fetchResult.status === 'success') {
      setLoadingContent(true)
      invoke<string>('read_fetch_content', { storagePath: fetchResult.storage_path })
        .then(setContent)
        .catch((err) => {
          console.error('Failed to load fetch content:', err)
          setContent(null)
        })
        .finally(() => setLoadingContent(false))
    }
  }, [isDialogOpen, content, loadingContent, fetchResult])

  const handleOpenLink = () => {
    openUrl(fetchResult.url)
    setIsDialogOpen(false)
  }

  // Failed state
  if (isFailed) {
    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-muted text-left hover:border-muted-foreground/50 transition-colors cursor-pointer"
        >
          {faviconUrl && !faviconError ? (
            <img
              src={faviconUrl}
              alt=""
              className="h-4 w-4 rounded-sm flex-shrink-0"
              onError={() => setFaviconError(true)}
            />
          ) : (
            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}

          <span className="flex-1 text-sm truncate">
            <span className="font-medium">Failed to fetch</span>
            <span className="text-muted-foreground ml-1">{fetchResult.url}</span>
          </span>

          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        </button>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {faviconUrl && !faviconError ? (
                  <img src={faviconUrl} alt="" className="h-5 w-5 rounded-sm flex-shrink-0" />
                ) : (
                  <Globe className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                )}
                Failed to fetch
              </DialogTitle>
            </DialogHeader>

            <div className="px-3 py-2 bg-muted/50 rounded-md">
              <p className="text-sm text-muted-foreground break-all font-mono">{fetchResult.url}</p>
            </div>

            {fetchResult.error && (
              <div className="px-3 py-2 bg-destructive/10 rounded-md">
                <p className="text-sm text-destructive">{fetchResult.error}</p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleOpenLink}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Link
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  // Success state
  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-muted text-left hover:border-muted-foreground/50 transition-colors cursor-pointer"
      >
        {faviconUrl && !faviconError ? (
          <img
            src={faviconUrl}
            alt=""
            className="h-4 w-4 rounded-sm flex-shrink-0"
            onError={() => setFaviconError(true)}
          />
        ) : (
          <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}

        <span className="flex-1 text-sm truncate">
          <span className="font-medium">Fetched</span>
          <span className="text-muted-foreground ml-1">{title}</span>
        </span>

        <span className="text-sm text-muted-foreground flex-shrink-0">{domain}</span>
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {faviconUrl && !faviconError ? (
                <img src={faviconUrl} alt="" className="h-5 w-5 rounded-sm flex-shrink-0" />
              ) : (
                <Globe className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              )}
              {title}
            </DialogTitle>
          </DialogHeader>

          <div className="px-3 py-2 bg-muted/50 rounded-md">
            <p className="text-sm text-muted-foreground break-all font-mono">{fetchResult.url}</p>
          </div>

          <div className="flex-1 overflow-y-auto border rounded-md p-4 min-h-[200px]">
            {loadingContent ? (
              <p className="text-sm text-muted-foreground">Loading content...</p>
            ) : content ? (
              <MarkdownContent content={content} className="text-sm" />
            ) : (
              <p className="text-sm text-muted-foreground">No content available</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleOpenLink}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Inline FetchResult item for search results - reuses the same dialog as FetchResultPreview
function SearchResultFetchItem({ fetchResult }: { fetchResult: FetchResult }) {
  const [faviconError, setFaviconError] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)

  const faviconUrl = useMemo(() => getFaviconUrl(fetchResult), [fetchResult])
  const domain = getDomain(fetchResult.url)
  const title = fetchResult.title || domain
  const isFailed = fetchResult.status === 'failed'

  // Load content from filesystem when dialog opens
  useEffect(() => {
    if (isDialogOpen && !content && !loadingContent && fetchResult.status === 'success') {
      setLoadingContent(true)
      invoke<string>('read_fetch_content', { storagePath: fetchResult.storage_path })
        .then(setContent)
        .catch((err) => {
          console.error('Failed to load fetch content:', err)
          setContent(null)
        })
        .finally(() => setLoadingContent(false))
    }
  }, [isDialogOpen, content, loadingContent, fetchResult])

  const handleOpenLink = () => {
    openUrl(fetchResult.url)
    setIsDialogOpen(false)
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsDialogOpen(true)
        }}
        className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        {faviconUrl && !faviconError ? (
          <img
            src={faviconUrl}
            alt=""
            className="h-4 w-4 rounded-sm flex-shrink-0"
            onError={() => setFaviconError(true)}
          />
        ) : (
          <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}

        <span className="flex-1 text-sm truncate">
          {isFailed ? (
            <>
              <span className="font-medium text-destructive">Failed</span>
              <span className="text-muted-foreground ml-1">{title}</span>
            </>
          ) : (
            <>
              <span className="font-medium">Fetched</span>
              <span className="text-muted-foreground ml-1">{title}</span>
            </>
          )}
        </span>

        <span className="text-sm text-muted-foreground flex-shrink-0">{domain}</span>

        {isFailed && <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />}
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {faviconUrl && !faviconError ? (
                <img src={faviconUrl} alt="" className="h-5 w-5 rounded-sm flex-shrink-0" />
              ) : (
                <Globe className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              )}
              {isFailed ? 'Failed to fetch' : title}
            </DialogTitle>
          </DialogHeader>

          <div className="px-3 py-2 bg-muted/50 rounded-md">
            <p className="text-sm text-muted-foreground break-all font-mono">{fetchResult.url}</p>
          </div>

          {isFailed && fetchResult.error && (
            <div className="px-3 py-2 bg-destructive/10 rounded-md">
              <p className="text-sm text-destructive">{fetchResult.error}</p>
            </div>
          )}

          {!isFailed && (
            <div className="flex-1 overflow-y-auto border rounded-md p-4 min-h-[200px]">
              {loadingContent ? (
                <p className="text-sm text-muted-foreground">Loading content...</p>
              ) : content ? (
                <MarkdownContent content={content} className="text-sm" />
              ) : (
                <p className="text-sm text-muted-foreground">No content available</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleOpenLink}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Processing URL item - shown while fetching
function ProcessingUrlItem({ url }: { url: string }) {
  const domain = getDomain(url)

  return (
    <div className="flex items-center gap-2.5 w-full px-3 py-2 text-left">
      <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0 animate-pulse" />
      <span className="flex-1 text-sm text-muted-foreground truncate">Fetching from {domain}</span>
    </div>
  )
}

// SearchResult preview component - expandable inline list
function SearchResultPreview({
  searchResult,
  urlStatuses,
}: {
  searchResult: SearchResult
  urlStatuses?: Record<string, 'fetching' | 'fetched'>
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
    // Skip loading while still searching (no results yet)
    if (isSearching) {
      return
    }

    const loadResults = async () => {
      setLoading(true)
      try {
        // Use the new API with source_type and source_id
        const results = await invoke<FetchResult[]>('get_fetch_results_by_source', {
          sourceType: 'search',
          sourceId: searchResult.id,
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
    searchResult.id,
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
function SearchDecisionPreview({ decision }: { decision: SearchDecision }) {
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Reasoning
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed">{decision.reasoning}</p>
          </div>

          {/* Search query if search was needed */}
          {decision.search_needed && decision.search_query && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Search Query
              </p>
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 rounded-md">
                <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <code className="text-sm font-mono">{decision.search_query}</code>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Helper function to check if file is markdown
function isMarkdownFile(fileName: string, mimeType?: string): boolean {
  const lowerName = fileName.toLowerCase()
  return (
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/x-markdown'
  )
}

/** Props for FilePreviewDialog - supports both storage paths and in-memory content */
export interface FilePreviewDialogProps {
  isOpen: boolean
  onClose: () => void
  fileName: string
  /** In-memory content (used directly if provided) */
  content?: string
  /** Storage path (loads content via Tauri if content not provided) */
  storagePath?: string
  mimeType?: string
  size?: number
}

// File preview dialog component - supports both storage paths and in-memory content
// Exported for reuse in other components (e.g., chat-input)
export function FilePreviewDialog({
  isOpen,
  onClose,
  fileName,
  content: inMemoryContent,
  storagePath,
  mimeType,
  size,
}: FilePreviewDialogProps) {
  const [loadedContent, setLoadedContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isMarkdown = isMarkdownFile(fileName, mimeType)

  // Determine content source
  const content = inMemoryContent ?? loadedContent

  // Load content from storage path when dialog opens (only if no in-memory content)
  useEffect(() => {
    if (isOpen && !inMemoryContent && storagePath && !loadedContent && !loading) {
      setLoading(true)
      invoke<string>('read_file_content', { storagePath })
        .then(setLoadedContent)
        .catch((err) => {
          console.error('Failed to load file content:', err)
          setLoadedContent(null)
        })
        .finally(() => setLoading(false))
    }
  }, [isOpen, inMemoryContent, storagePath, loadedContent, loading])

  // Reset loaded content when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setLoadedContent(null)
    }
  }, [isOpen])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            {fileName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {size !== undefined && <span>{formatFileSize(size)}</span>}
          {mimeType && <span>{mimeType}</span>}
        </div>

        {/* Content preview area */}
        <div className="flex-1 overflow-auto border rounded-md p-4 min-h-[200px]">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : content ? (
            isMarkdown ? (
              <MarkdownContent content={content} className="text-sm" />
            ) : (
              <pre className="text-sm whitespace-pre-wrap font-mono">{content}</pre>
            )
          ) : (
            <p className="text-sm text-muted-foreground">No content available</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Fullscreen Image Lightbox component with keyboard navigation
// Exported for reuse in other components (e.g., chat-input)
export function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: ImageAttachmentData[]
  initialIndex: number
  onClose: () => void
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const currentImage = images[currentIndex]
  const hasMultiple = images.length > 1
  const canGoPrev = currentIndex > 0
  const canGoNext = currentIndex < images.length - 1

  // Load current image - supports both storage paths and base64 data
  useEffect(() => {
    // If base64 is provided, use it directly (no loading needed)
    if (currentImage.base64) {
      setImageSrc(currentImage.base64)
      setLoading(false)
      return
    }

    // Otherwise, load from storage path
    if (currentImage.storagePath) {
      setLoading(true)
      setImageSrc(null)

      invoke<string>('get_attachment_url', { storagePath: currentImage.storagePath })
        .then((fullPath) => {
          setImageSrc(convertFileSrc(fullPath))
        })
        .catch((err) => {
          console.error('Failed to load image:', err)
          setImageSrc(null)
        })
        .finally(() => setLoading(false))
    } else {
      // No source available
      setLoading(false)
      setImageSrc(null)
    }
  }, [currentImage.storagePath, currentImage.base64])

  const goToPrev = useCallback(() => {
    if (canGoPrev) {
      setCurrentIndex((i) => i - 1)
    }
  }, [canGoPrev])

  const goToNext = useCallback(() => {
    if (canGoNext) {
      setCurrentIndex((i) => i + 1)
    }
  }, [canGoNext])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft') {
        goToPrev()
      } else if (e.key === 'ArrowRight') {
        goToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, goToPrev, goToNext])

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return createPortal(
    <div
      className="fixed top-0 left-0 right-0 bottom-0 z-[9999] flex items-center justify-center bg-black"
      style={{ width: '100vw', height: '100vh' }}
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        aria-label="Close"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {/* Image counter */}
      {hasMultiple && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-medium">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {/* Previous button */}
      {hasMultiple && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            goToPrev()
          }}
          disabled={!canGoPrev}
          className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full transition-colors ${
            canGoPrev
              ? 'bg-white/10 hover:bg-white/20 text-white cursor-pointer'
              : 'bg-white/5 text-white/30 cursor-not-allowed'
          }`}
          aria-label="Previous image"
        >
          <ChevronLeft className="h-8 w-8" />
        </button>
      )}

      {/* Next button */}
      {hasMultiple && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            goToNext()
          }}
          disabled={!canGoNext}
          className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full transition-colors ${
            canGoNext
              ? 'bg-white/10 hover:bg-white/20 text-white cursor-pointer'
              : 'bg-white/5 text-white/30 cursor-not-allowed'
          }`}
          aria-label="Next image"
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      )}

      {/* Image container */}
      <div
        className="w-full h-full p-16 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="text-white/50 text-lg">Loading...</div>
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt={currentImage.fileName}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
          />
        ) : (
          <div className="text-white/50 text-lg">Failed to load image</div>
        )}
      </div>

      {/* File name */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-lg bg-white/10 text-white text-sm max-w-[80%] truncate">
        {currentImage.fileName}
      </div>
    </div>,
    document.body
  )
}

// FileAttachment preview component - handles both text files and images
function FileAttachmentPreview({
  fileAttachment,
  allImages,
  currentImageIndex,
}: {
  fileAttachment: FileAttachment
  allImages?: ImageAttachmentData[]
  currentImageIndex?: number
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)

  const isImage = fileAttachment.mime_type.startsWith('image/')
  const IconComponent = isImage
    ? Image
    : fileAttachment.mime_type.startsWith('text/')
      ? FileText
      : FileIconLucide

  // For images, use lightbox; for other files, use dialog
  const handleClick = () => {
    if (isImage) {
      setIsLightboxOpen(true)
    } else {
      setIsDialogOpen(true)
    }
  }

  // Prepare images array for lightbox
  const lightboxImages: ImageAttachmentData[] = useMemo(() => {
    if (allImages && allImages.length > 0) {
      return allImages
    }
    // Fallback to single image if no allImages provided
    return [
      {
        id: fileAttachment.id,
        fileName: fileAttachment.file_name,
        storagePath: fileAttachment.storage_path,
      },
    ]
  }, [allImages, fileAttachment])

  const lightboxIndex = currentImageIndex ?? 0

  return (
    <>
      <button
        onClick={handleClick}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-muted text-left hover:border-muted-foreground/50 transition-colors cursor-pointer"
      >
        <IconComponent className="h-4 w-4 text-muted-foreground flex-shrink-0" />

        <span className="flex-1 text-sm truncate">
          <span className="font-medium">{fileAttachment.file_name}</span>
        </span>

        <span className="text-sm text-muted-foreground flex-shrink-0">
          {formatFileSize(fileAttachment.file_size)}
        </span>
      </button>

      {/* Lightbox for images */}
      {isImage && isLightboxOpen && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={() => setIsLightboxOpen(false)}
        />
      )}

      {/* Dialog for non-image files - uses reusable FilePreviewDialog */}
      {!isImage && (
        <FilePreviewDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          fileName={fileAttachment.file_name}
          storagePath={fileAttachment.storage_path}
          mimeType={fileAttachment.mime_type}
          size={fileAttachment.file_size}
        />
      )}
    </>
  )
}

// Pending SearchDecision preview - shown while AI is deciding
function PendingSearchDecisionPreview() {
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

// ThinkingPreview component - displays AI's reasoning/thinking process
export function ThinkingPreview({
  content,
  isStreaming = false,
}: {
  content: string
  /** Whether thinking is still in progress (streaming) */
  isStreaming?: boolean
}) {
  // Auto-expand when streaming to show live thinking
  const [isExpanded, setIsExpanded] = useState(isStreaming)

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true)
    }
  }, [isStreaming])

  return (
    <div className="w-full rounded-lg border border-muted overflow-hidden bg-muted/20">
      {/* Header row */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <Lightbulb
          className={`h-4 w-4 text-muted-foreground flex-shrink-0 ${isStreaming ? 'animate-pulse' : ''}`}
        />

        <span className="flex-1 text-sm truncate">
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground flex-shrink-0">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="border-t border-muted px-3 py-3 max-h-80 overflow-y-auto">
          <div className="text-sm text-muted-foreground/80 leading-relaxed whitespace-pre-wrap">
            {content ? (
              <MarkdownContent content={content} className="text-sm" />
            ) : isStreaming ? (
              <span className="text-muted-foreground/60 italic">Processing...</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export function AttachmentPreview({
  userAttachment,
  context,
  step,
  processingUrl,
  urlStatuses,
  pendingSearchDecision,
  allImages,
  currentImageIndex,
}: AttachmentPreviewProps) {
  // Pending search decision state
  if (pendingSearchDecision) {
    return <PendingSearchDecisionPreview />
  }

  // Loading state: "Fetching from [domain]"
  if (processingUrl) {
    const domain = getDomain(processingUrl)

    return (
      <button
        onClick={() => openUrl(processingUrl)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-muted text-left hover:border-muted-foreground/50 transition-colors cursor-pointer"
      >
        <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="flex-1 text-sm text-muted-foreground truncate">
          Fetching from {domain}
        </span>
      </button>
    )
  }

  // Handle user attachments (files, user links)
  if (userAttachment) {
    switch (userAttachment.type) {
      case 'file':
        return (
          <FileAttachmentPreview
            fileAttachment={userAttachment as FileAttachment}
            allImages={allImages}
            currentImageIndex={currentImageIndex}
          />
        )
      case 'user_link':
        // For now, treat user links as URLs to fetch
        // TODO: Add UserLinkPreview component
        return null
      default:
        return null
    }
  }

  // Handle context enrichments (search results, fetch results)
  if (context) {
    switch (context.type) {
      case 'fetch_result':
        return <FetchResultPreview fetchResult={context as FetchResult} />
      case 'search_result':
        return (
          <SearchResultPreview searchResult={context as SearchResult} urlStatuses={urlStatuses} />
        )
      default:
        return null
    }
  }

  // Handle process steps (search decisions, thinking - note: thinking is handled by ThinkingPreview)
  if (step) {
    switch (step.type) {
      case 'search_decision':
        return <SearchDecisionPreview decision={step as SearchDecision} />
      case 'thinking':
        // Thinking is handled by ThinkingPreview component directly
        return null
      case 'tool_call':
        // TODO: Add ToolCallPreview component
        return null
      case 'code_execution':
        // TODO: Add CodeExecutionPreview component
        return null
      default:
        return null
    }
  }

  return null
}
