import { useState } from "react"
import { Globe, ExternalLink, AlertTriangle, FileText, Image, FileIcon } from "lucide-react"
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
import type { Attachment } from "@/types"

interface AttachmentPreviewProps {
  /** Attachment resource (for completed processing) */
  attachment?: Attachment
  /** URL being processed (for loading state) */
  processingUrl?: string
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

// Get icon based on attachment type and content format
function getAttachmentIcon(attachment: Attachment) {
  // For web fetch results, always use Globe
  if (attachment.origin === "web") {
    return Globe
  }
  
  // For local files, use appropriate icon based on MIME type
  const mimeType = attachment.content_format || attachment.mime_type || ""
  
  if (mimeType.startsWith("image/")) {
    return Image
  }
  if (mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml")) {
    return FileText
  }
  
  return FileIcon
}

export function AttachmentPreview({ attachment, processingUrl }: AttachmentPreviewProps) {
  const [faviconError, setFaviconError] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  
  // Loading state: "Fetching from [domain]"
  if (processingUrl) {
    const domain = getDomain(processingUrl)
    
    return (
      <button
        onClick={() => openUrl(processingUrl)}
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
  
  // No attachment provided
  if (!attachment) {
    return null
  }
  
  const isWebAttachment = attachment.origin === "web"
  const faviconUrl = attachment.url ? getFaviconUrl(attachment.url) : ""
  const domain = attachment.url ? getDomain(attachment.url) : ""
  const title = attachment.title || attachment.file_name || "Unknown"
  const hasContent = attachment.content && attachment.extraction_status === "success"
  const isFailed = attachment.extraction_status === "failed"
  const IconComponent = getAttachmentIcon(attachment)
  
  const handleOpenLink = () => {
    if (attachment.url) {
      openUrl(attachment.url)
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
          {/* Icon */}
          {isWebAttachment && faviconUrl && !faviconError ? (
            <img 
              src={faviconUrl} 
              alt="" 
              className="h-4 w-4 rounded-sm flex-shrink-0"
              onError={() => setFaviconError(true)}
            />
          ) : (
            <IconComponent className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
          
          {/* "Failed to fetch" + URL/name */}
          <span className="flex-1 text-sm truncate">
            <span className="font-medium">Failed to fetch</span>
            <span className="text-muted-foreground ml-1">{attachment.url || attachment.file_name}</span>
          </span>
          
          {/* Warning icon */}
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        </button>
        
        {/* Failed Dialog - without content section */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {isWebAttachment && faviconUrl && !faviconError ? (
                  <img 
                    src={faviconUrl} 
                    alt="" 
                    className="h-5 w-5 rounded-sm flex-shrink-0"
                  />
                ) : (
                  <IconComponent className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                )}
                Failed to fetch
              </DialogTitle>
            </DialogHeader>
            
            {/* URL/path section */}
            <div className="px-3 py-2 bg-muted/50 rounded-md">
              <p className="text-sm text-muted-foreground break-all font-mono">
                {attachment.url || attachment.file_path}
              </p>
            </div>
            
            {/* Error message */}
            {attachment.extraction_error && (
              <div className="px-3 py-2 bg-destructive/10 rounded-md">
                <p className="text-sm text-destructive">
                  {attachment.extraction_error}
                </p>
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              {attachment.url && (
                <Button onClick={handleOpenLink}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Link
                </Button>
              )}
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
        {/* Icon */}
        {isWebAttachment && faviconUrl && !faviconError ? (
          <img 
            src={faviconUrl} 
            alt="" 
            className="h-4 w-4 rounded-sm flex-shrink-0"
            onError={() => setFaviconError(true)}
          />
        ) : (
          <IconComponent className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        
        {/* "Fetched" label + title */}
        <span className="flex-1 text-sm truncate">
          <span className="font-medium">Fetched</span>
          <span className="text-muted-foreground ml-1">{title}</span>
        </span>
        
        {/* Domain/info + external link icon */}
        <span className="flex items-center gap-1.5 flex-shrink-0 text-muted-foreground">
          {domain && <span className="text-sm">{domain}</span>}
          {attachment.url && <ExternalLink className="h-4 w-4" />}
        </span>
      </button>
      
      {/* Detail Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isWebAttachment && faviconUrl && !faviconError ? (
                <img 
                  src={faviconUrl} 
                  alt="" 
                  className="h-5 w-5 rounded-sm flex-shrink-0"
                />
              ) : (
                <IconComponent className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              )}
              {title}
            </DialogTitle>
          </DialogHeader>
          
          {/* URL/path section */}
          {(attachment.url || attachment.file_path) && (
            <div className="px-3 py-2 bg-muted/50 rounded-md">
              <p className="text-sm text-muted-foreground break-all font-mono">
                {attachment.url || attachment.file_path}
              </p>
            </div>
          )}
          
          {/* Content section */}
          <div className="flex-1 overflow-y-auto border rounded-md p-4 min-h-[200px]">
            {hasContent ? (
              <MarkdownContent 
                content={attachment.content!} 
                className="text-sm"
              />
            ) : attachment.extraction_status === "failed" ? (
              <p className="text-sm text-destructive">
                {attachment.extraction_error || "Failed to fetch content"}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No content available</p>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            {attachment.url && (
              <Button onClick={handleOpenLink}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

