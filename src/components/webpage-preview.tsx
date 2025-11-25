import { useState, useMemo } from "react"
import { ChevronDown, ChevronRight, Globe, ExternalLink, Loader2 } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MarkdownContent } from "@/components/markdown-content"
import type { ExternalResource, WebpageMetadata } from "@/types"

interface WebpagePreviewProps {
  /** Scraped webpage resource (for completed scrapes) */
  resource?: ExternalResource
  /** URL being scraped (for loading state) */
  scrapingUrl?: string
}

// Extract favicon URL from a webpage URL using Google's favicon service
function getFaviconUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`
  } catch {
    return ""
  }
}

export function WebpagePreview({ resource, scrapingUrl }: WebpagePreviewProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [faviconError, setFaviconError] = useState(false)
  
  // If scrapingUrl is provided, show simple loading state
  if (scrapingUrl) {
    const faviconUrl = getFaviconUrl(scrapingUrl)
    
    return (
      <div className="flex items-center gap-2 w-full p-2 rounded-lg bg-muted/30 text-left">
        {/* Spinner */}
        <Loader2 className="h-4 w-4 text-muted-foreground animate-spin flex-shrink-0" />
        
        {/* Favicon */}
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
        
        {/* URL */}
        <span className="flex-1 text-sm text-muted-foreground truncate">
          {scrapingUrl}
        </span>
        
        {/* External link */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            openUrl(scrapingUrl)
          }}
          className="flex-shrink-0 hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
    )
  }
  
  // No resource provided
  if (!resource) {
    return null
  }
  
  // Parse metadata if available
  const metadata: WebpageMetadata | null = useMemo(() => {
    if (!resource.metadata) return null
    try {
      return JSON.parse(resource.metadata)
    } catch {
      return null
    }
  }, [resource.metadata])
  
  const faviconUrl = resource.url ? getFaviconUrl(resource.url) : ""
  const title = resource.title || resource.url || "Unknown webpage"
  const hasContent = resource.extracted_content && resource.extraction_status === "success"
  const isPending = resource.extraction_status === "pending"
  const isFailed = resource.extraction_status === "failed"
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left group">
        {/* Expand/Collapse icon */}
        <span className="text-muted-foreground flex-shrink-0">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
        
        {/* Favicon */}
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
        
        {/* Title */}
        <span className="flex-1 text-sm font-medium truncate">
          {title}
        </span>
        
        {/* Status indicator */}
        {isPending && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </span>
        )}
        {isFailed && (
          <span className="text-xs text-destructive flex-shrink-0">Failed</span>
        )}
        
        {/* External link */}
        {resource.url && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              openUrl(resource.url!)
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </CollapsibleTrigger>
      
      <CollapsibleContent className="pt-2">
        <div className="rounded-lg border bg-card p-3 max-h-64 overflow-y-auto">
          {/* Description if available */}
          {resource.description && (
            <p className="text-sm text-muted-foreground mb-2 italic">
              {resource.description}
            </p>
          )}
          
          {/* Extracted content */}
          {hasContent ? (
            <MarkdownContent 
              content={resource.extracted_content!} 
              className="text-sm"
              compact
            />
          ) : isFailed ? (
            <p className="text-sm text-destructive">
              {resource.extraction_error || "Failed to fetch webpage content"}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading content...</p>
          )}
          
          {/* Metadata: Headings preview */}
          {metadata?.headings && metadata.headings.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-muted-foreground mb-1">Headings:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {metadata.headings.slice(0, 5).map((heading, i) => (
                  <li key={i} className="truncate">• {heading}</li>
                ))}
                {metadata.headings.length > 5 && (
                  <li className="text-muted-foreground/60">
                    ... and {metadata.headings.length - 5} more
                  </li>
                )}
              </ul>
            </div>
          )}
          
          {/* Truncation notice */}
          {metadata?.truncated && (
            <p className="text-xs text-muted-foreground/60 mt-2 italic">
              Content truncated from {metadata.original_length?.toLocaleString()} characters
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
