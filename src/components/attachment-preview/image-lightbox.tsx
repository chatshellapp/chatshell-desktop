import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import type { ImageAttachmentData } from './types'
import { logger } from '@/lib/logger'

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
          logger.error('Failed to load image:', err)
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
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm">
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
