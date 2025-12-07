import { useState, useMemo, useEffect } from 'react'
import { Globe, ExternalLink, AlertTriangle } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { invoke } from '@tauri-apps/api/core'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from '@/components/markdown-content'
import type { FetchResult } from '@/types'
import { getDomain, getFaviconUrl } from './utils'

// FetchResult preview component
export function FetchResultPreview({ fetchResult }: { fetchResult: FetchResult }) {
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
            <span>Failed to fetch</span>
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
          <span>Fetched</span>
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
export function SearchResultFetchItem({ fetchResult }: { fetchResult: FetchResult }) {
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
              <span className="text-destructive">Failed</span>
              <span className="text-muted-foreground ml-1">{title}</span>
            </>
          ) : (
            <>
              <span>Fetched</span>
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
export function ProcessingUrlItem({ url }: { url: string }) {
  const domain = getDomain(url)

  return (
    <div className="flex items-center gap-2.5 w-full px-3 py-2 text-left">
      <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0 animate-pulse" />
      <span className="flex-1 text-sm text-muted-foreground truncate">Fetching from {domain}</span>
    </div>
  )
}

