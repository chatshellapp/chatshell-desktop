import { Globe } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { FetchResult, SearchResult, FileAttachment, SearchDecision } from '@/types'

// Re-export types
export type { ImageAttachmentData, AttachmentPreviewProps, FilePreviewDialogProps } from './types'

// Re-export components
export { FetchResultPreview } from './fetch-result-preview'
export { SearchResultPreview, SearchDecisionPreview, PendingSearchDecisionPreview } from './search-result-preview'
export { FilePreviewDialog, FileAttachmentPreview } from './file-preview'
export { ImageLightbox } from './image-lightbox'
export { ThinkingPreview } from './thinking-preview'

// Re-export utilities
export { getDomain, getFaviconUrl, formatFileSize, isMarkdownFile } from './utils'

// Import for internal use
import type { AttachmentPreviewProps } from './types'
import { getDomain } from './utils'
import { FetchResultPreview } from './fetch-result-preview'
import { SearchResultPreview, SearchDecisionPreview, PendingSearchDecisionPreview } from './search-result-preview'
import { FileAttachmentPreview } from './file-preview'

export function AttachmentPreview({
  userAttachment,
  context,
  step,
  processingUrl,
  urlStatuses,
  messageId,
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

  // Handle user attachments (files only; user URLs are stored as fetch_results)
  if (userAttachment) {
    if (userAttachment.type === 'file') {
      return (
        <FileAttachmentPreview
          fileAttachment={userAttachment as FileAttachment}
          allImages={allImages}
          currentImageIndex={currentImageIndex}
        />
      )
    }
    return null
  }

  // Handle context enrichments (search results, fetch results)
  if (context) {
    switch (context.type) {
      case 'fetch_result':
        return <FetchResultPreview fetchResult={context as FetchResult} />
      case 'search_result':
        return (
          <SearchResultPreview
            searchResult={context as SearchResult}
            urlStatuses={urlStatuses}
            messageId={messageId}
          />
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

