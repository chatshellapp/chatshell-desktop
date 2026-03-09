import { useState, useEffect, useMemo } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { ImageLightbox, type ImageAttachmentData } from '@/components/attachment-preview'
import { logger } from '@/lib/logger'
import type { UserAttachment } from '@/types'

function GeneratedImageItem({
  attachment,
  allImages,
  imageIndex,
}: {
  attachment: UserAttachment
  allImages: ImageAttachmentData[]
  imageIndex: number
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    invoke<string>('get_attachment_url', { storagePath: attachment.storage_path })
      .then((fullPath) => setSrc(convertFileSrc(fullPath)))
      .catch((err) => logger.error('Failed to load generated image:', err))
  }, [attachment.storage_path])

  if (!src) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="cursor-pointer rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
      >
        <img
          src={src}
          alt={attachment.file_name}
          data-storage-path={attachment.storage_path}
          className="max-w-full md:max-w-[512px] h-auto rounded-lg shadow-sm"
          loading="lazy"
        />
      </button>
      {lightboxOpen && (
        <ImageLightbox
          images={allImages}
          initialIndex={imageIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  )
}

export function GeneratedImageGallery({ attachments }: { attachments: UserAttachment[] }) {
  const allImages: ImageAttachmentData[] = useMemo(
    () =>
      attachments.map((a) => ({
        id: a.id,
        fileName: a.file_name,
        storagePath: a.storage_path,
      })),
    [attachments]
  )

  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-3 mt-1 mb-2">
      {attachments.map((attachment, index) => (
        <GeneratedImageItem
          key={attachment.id}
          attachment={attachment}
          allImages={allImages}
          imageIndex={index}
        />
      ))}
    </div>
  )
}
