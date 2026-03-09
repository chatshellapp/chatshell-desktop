import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Copy, Check, Download } from 'lucide-react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import type { ImageAttachmentData } from './types'
import { logger } from '@/lib/logger'

function base64ToBytes(base64: string): Uint8Array {
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function resolveImageBytesSync(image: ImageAttachmentData): Uint8Array | null {
  if (image.base64) {
    const [, data] = image.base64.split(',')
    if (data) return base64ToBytes(data)
  }
  return null
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
  const { t } = useTranslation(['common', 'attachments'])
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [copied, setCopied] = useState(false)

  const currentImage = images[currentIndex]
  const hasMultiple = images.length > 1
  const canGoPrev = currentIndex > 0
  const canGoNext = currentIndex < images.length - 1

  const handleCopy = useCallback(async () => {
    try {
      await invoke('copy_image_to_clipboard', {
        storagePath: currentImage.storagePath ?? null,
        base64Data: currentImage.base64 ?? null,
      })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      logger.error('Failed to copy image:', err)
    }
  }, [currentImage])

  const handleDownload = useCallback(async () => {
    try {
      let bytes: Uint8Array
      if (currentImage.storagePath) {
        const b64 = await invoke<string>('read_image_base64', {
          storagePath: currentImage.storagePath,
        })
        bytes = base64ToBytes(b64)
      } else if (currentImage.base64) {
        const result = resolveImageBytesSync(currentImage)
        if (!result) return
        bytes = result
      } else {
        return
      }

      const defaultName = currentImage.fileName.includes('.')
        ? currentImage.fileName
        : `${currentImage.fileName}.png`
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      })
      if (!filePath) return
      await writeFile(filePath, bytes)
    } catch (err) {
      logger.error('Failed to download image:', err)
    }
  }, [currentImage])

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
      setCopied(false)
    }
  }, [canGoPrev])

  const goToNext = useCallback(() => {
    if (canGoNext) {
      setCurrentIndex((i) => i + 1)
      setCopied(false)
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
        aria-label={t('attachments:close')}
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {/* Image counter */}
      {hasMultiple && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm">
          {t('attachments:imageOf', { current: currentIndex + 1, total: images.length })}
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
          aria-label={t('attachments:previous')}
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
          aria-label={t('attachments:next')}
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
          <div className="text-white/50 text-lg">{t('loading')}</div>
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt={currentImage.fileName}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
          />
        ) : (
          <div className="text-white/50 text-lg">{t('attachments:failedToLoadImage')}</div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10">
        <span className="text-white text-sm max-w-[50vw] truncate">
          {currentImage.fileName}
        </span>
        <div className="h-4 w-px bg-white/20" />
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleCopy()
          }}
          className="p-1.5 rounded hover:bg-white/10 transition-colors text-white cursor-pointer"
          aria-label={t('attachments:copy')}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDownload()
          }}
          className="p-1.5 rounded hover:bg-white/10 transition-colors text-white cursor-pointer"
          aria-label={t('attachments:download')}
        >
          <Download className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body
  )
}
