import { useState } from "react"
import { Globe, ExternalLink, AlertTriangle } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/markdown-content"
import type { ExternalResource } from "@/types"

interface WebpagePreviewProps {
  /** Scraped webpage resource (for completed scrapes) */
  resource?: ExternalResource
  /** URL being scraped (for loading state) */
  scrapingUrl?: string
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
  const [faviconError, setFaviconError] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  
  // Loading state: "Fetching from [domain]"
  if (scrapingUrl) {
    const domain = getDomain(scrapingUrl)
    
    return (
      <button
        onClick={() => openUrl(scrapingUrl)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-muted text-left hover:border-muted-foreground/50 transition-colors cursor-pointer"
      >
        {/* Globe icon */}
        <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        
        {/* Fetching text */}
        <span className="flex-1 text-sm text-muted-foreground truncate">
          Fetching from {domain}
        </span>
        
        {/* External link icon */}
        <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </button>
    )
  }
  
  // No resource provided
  if (!resource) {
    return null
  }
  
  const faviconUrl = resource.url ? getFaviconUrl(resource.url) : ""
  const domain = resource.url ? getDomain(resource.url) : ""
  const title = resource.title || "Unknown webpage"
  const hasContent = resource.extracted_content && resource.extraction_status === "success"
  const isFailed = resource.extraction_status === "failed"
  
  const handleOpenLink = () => {
    if (resource.url) {
      openUrl(resource.url)
    }
    setIsDialogOpen(false)
  }
  
  // Failed state: "Failed to fetch [url]" + warning icon
  if (isFailed) {
    return (
      <>
        <button
          onClick={() => setIsDialogOpen(true)}
          className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-muted text-left hover:border-muted-foreground/50 transition-colors cursor-pointer"
        >
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
          
          {/* "Failed to fetch" + URL */}
          <span className="flex-1 text-sm truncate">
            <span className="font-medium">Failed to fetch</span>
            <span className="text-muted-foreground ml-1">{resource.url}</span>
          </span>
          
          {/* Warning icon */}
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        </button>
        
        {/* Failed Dialog - without content section */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {faviconUrl && !faviconError ? (
                  <img 
                    src={faviconUrl} 
                    alt="" 
                    className="h-5 w-5 rounded-sm flex-shrink-0"
                  />
                ) : (
                  <Globe className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                )}
                Failed to fetch
              </DialogTitle>
            </DialogHeader>
            
            {/* URL section */}
            <div className="px-3 py-2 bg-muted/50 rounded-md">
              <p className="text-sm text-muted-foreground break-all font-mono">
                {resource.url}
              </p>
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
  
  // Completed state: "Fetched [title]" + domain + external link
  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-muted text-left hover:border-muted-foreground/50 transition-colors cursor-pointer"
      >
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
        
        {/* "Fetched" label + title */}
        <span className="flex-1 text-sm truncate">
          <span className="font-medium">Fetched</span>
          <span className="text-muted-foreground ml-1">{title}</span>
        </span>
        
        {/* Domain + external link icon */}
        <span className="flex items-center gap-1.5 flex-shrink-0 text-muted-foreground">
          <span className="text-sm">{domain}</span>
          <ExternalLink className="h-4 w-4" />
        </span>
      </button>
      
      {/* Detail Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {faviconUrl && !faviconError ? (
                <img 
                  src={faviconUrl} 
                  alt="" 
                  className="h-5 w-5 rounded-sm flex-shrink-0"
                />
              ) : (
                <Globe className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              )}
              {title}
            </DialogTitle>
          </DialogHeader>
          
          {/* URL section */}
          <div className="px-3 py-2 bg-muted/50 rounded-md">
            <p className="text-sm text-muted-foreground break-all font-mono">
              {resource.url}
            </p>
          </div>
          
          {/* Content section */}
          <div className="flex-1 overflow-y-auto border rounded-md p-4 min-h-[200px]">
            {hasContent ? (
              <MarkdownContent 
                content={resource.extracted_content!} 
                className="text-sm"
              />
            ) : resource.extraction_status === "failed" ? (
              <p className="text-sm text-destructive">
                {resource.extraction_error || "Failed to fetch webpage content"}
              </p>
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
