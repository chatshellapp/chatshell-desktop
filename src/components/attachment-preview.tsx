import { useState, useMemo, useEffect } from "react"
import { Globe, ExternalLink, AlertTriangle, FileText, Image, FileIcon as FileIconLucide, Search } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { invoke } from "@tauri-apps/api/core"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/markdown-content"
import type { Attachment, FetchResult, SearchResult, FileAttachment } from "@/types"

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
    return ""
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
  const isFailed = fetchResult.status === "failed"
  
  // Load content from filesystem when dialog opens
  useEffect(() => {
    if (isDialogOpen && !content && !loadingContent && fetchResult.status === "success") {
      setLoadingContent(true)
      invoke<string>("read_fetch_content", { storagePath: fetchResult.storage_path })
        .then(setContent)
        .catch((err) => {
          console.error("Failed to load fetch content:", err)
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
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
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
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
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

// SearchResult preview component
function SearchResultPreview({ searchResult }: { searchResult: SearchResult }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  
  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-muted text-left hover:border-muted-foreground/50 transition-colors cursor-pointer"
      >
        <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        
        <span className="flex-1 text-sm truncate">
          <span className="font-medium">Search:</span>
          <span className="text-muted-foreground ml-1">{searchResult.query}</span>
        </span>
        
        <span className="text-sm text-muted-foreground flex-shrink-0">
          {searchResult.engine}
        </span>
      </button>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              Search Results
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-2">
            <div className="px-3 py-2 bg-muted/50 rounded-md">
              <p className="text-sm font-medium">Query</p>
              <p className="text-sm text-muted-foreground">{searchResult.query}</p>
            </div>
            
            <div className="px-3 py-2 bg-muted/50 rounded-md">
              <p className="text-sm font-medium">Engine</p>
              <p className="text-sm text-muted-foreground">{searchResult.engine}</p>
            </div>
            
            {searchResult.total_results && (
              <div className="px-3 py-2 bg-muted/50 rounded-md">
                <p className="text-sm font-medium">Total Results</p>
                <p className="text-sm text-muted-foreground">{searchResult.total_results.toLocaleString()}</p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// FileAttachment preview component - handles both text files and images
function FileAttachmentPreview({ fileAttachment }: { fileAttachment: FileAttachment }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  
  const isImage = fileAttachment.mime_type.startsWith("image/")
  const IconComponent = isImage ? Image : 
                        fileAttachment.mime_type.startsWith("text/") ? FileText : FileIconLucide
  
  // Load content/image when dialog opens
  useEffect(() => {
    if (isDialogOpen && !content && !imageSrc && !loading) {
      setLoading(true)
      
      if (isImage) {
        // Load image as base64
        invoke<string>("read_image_base64", { storagePath: fileAttachment.storage_path })
          .then((base64) => {
            setImageSrc(`data:${fileAttachment.mime_type};base64,${base64}`)
          })
          .catch((err) => {
            console.error("Failed to load image:", err)
            setImageSrc(null)
          })
          .finally(() => setLoading(false))
      } else {
        // Load text content
        invoke<string>("read_file_content", { storagePath: fileAttachment.storage_path })
          .then(setContent)
          .catch((err) => {
            console.error("Failed to load file content:", err)
            setContent(null)
          })
          .finally(() => setLoading(false))
      }
    }
  }, [isDialogOpen, content, imageSrc, loading, fileAttachment, isImage])
  
  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
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
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className={isImage ? "max-w-3xl max-h-[90vh] flex flex-col" : "max-w-2xl max-h-[80vh] flex flex-col"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconComponent className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              {fileAttachment.file_name}
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{formatFileSize(fileAttachment.file_size)}</span>
            <span>{fileAttachment.mime_type}</span>
          </div>
          
          {/* Content preview area */}
          <div className="flex-1 overflow-auto border rounded-md p-4 min-h-[200px]">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : isImage ? (
              imageSrc ? (
                <div className="flex items-center justify-center h-full">
                  <img 
                    src={imageSrc} 
                    alt={fileAttachment.file_name} 
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Failed to load image</p>
              )
            ) : (
              content ? (
                <pre className="text-sm whitespace-pre-wrap font-mono">{content}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">No content available</p>
              )
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function AttachmentPreview({ attachment, processingUrl }: AttachmentPreviewProps) {
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
  
  // No attachment provided
  if (!attachment) {
    return null
  }
  
  // Route to appropriate component based on type
  switch (attachment.type) {
    case "fetch_result":
      return <FetchResultPreview fetchResult={attachment as FetchResult} />
    case "search_result":
      return <SearchResultPreview searchResult={attachment as SearchResult} />
    case "file":
      return <FileAttachmentPreview fileAttachment={attachment as FileAttachment} />
    default:
      return null
  }
}
