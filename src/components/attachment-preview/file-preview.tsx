import { useState, useEffect, useMemo } from 'react'
import { FileText, Image, FileIcon as FileIconLucide } from 'lucide-react'
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
import type { FileAttachment } from '@/types'
import type { FilePreviewDialogProps, ImageAttachmentData } from './types'
import { formatFileSize, isMarkdownFile } from './utils'
import { ImageLightbox } from './image-lightbox'

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

// FileAttachment preview component - handles both text files and images
export function FileAttachmentPreview({
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
          <span>{fileAttachment.file_name}</span>
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

