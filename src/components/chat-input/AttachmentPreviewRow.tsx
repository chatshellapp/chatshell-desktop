import { X } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Badge } from '@/components/ui/badge'
import { type Attachment, getAttachmentIcon, formatFileSize } from './types'

interface AttachmentPreviewRowProps {
  attachments: Attachment[]
  onRemove: (id: string) => void
  onImageClick: (imageIndex: number) => void
  onFileClick: (fileId: string) => void
}

export function AttachmentPreviewRow({
  attachments,
  onRemove,
  onImageClick,
  onFileClick,
}: AttachmentPreviewRowProps) {
  if (attachments.length === 0) {
    return null
  }

  // Get image attachments for index calculation
  const imageAttachments = attachments.filter((att) => att.type === 'image' && att.base64)

  return (
    <div className="order-first w-full flex flex-wrap gap-2 px-3 pt-3 pb-0">
      {attachments.map((attachment) => {
        // Get image index for lightbox navigation
        const imageIndex =
          attachment.type === 'image'
            ? imageAttachments.findIndex((img) => img.id === attachment.id)
            : -1

        const handlePreviewClick = () => {
          if (attachment.type === 'image' && attachment.base64) {
            onImageClick(imageIndex)
          } else if (attachment.type === 'file' && attachment.content) {
            onFileClick(attachment.id)
          }
        }

        const isPreviewable =
          (attachment.type === 'image' && attachment.base64) ||
          (attachment.type === 'file' && attachment.content)

        return (
          <Badge
            key={attachment.id}
            variant="outline"
            className="hover:bg-accent transition-colors text-muted-foreground hover:text-foreground gap-1.5"
          >
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              className="hover:text-destructive transition-colors -ml-0.5"
            >
              <X className="size-3" />
            </button>
            {isPreviewable ? (
              <button
                type="button"
                onClick={handlePreviewClick}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
              >
                {attachment.type === 'image' && attachment.base64 ? (
                  <img
                    src={attachment.base64}
                    alt={attachment.name}
                    className="h-4 w-4 object-cover rounded"
                  />
                ) : (
                  getAttachmentIcon(attachment.type)
                )}
                <span className="max-w-[150px] truncate">{attachment.name}</span>
                {attachment.size !== undefined && (
                  <span className="text-xs opacity-60">({formatFileSize(attachment.size)})</span>
                )}
              </button>
            ) : (
              <>
                {attachment.type === 'image' && attachment.base64 ? (
                  <img
                    src={attachment.base64}
                    alt={attachment.name}
                    className="h-4 w-4 object-cover rounded"
                  />
                ) : (
                  getAttachmentIcon(attachment.type)
                )}
                {attachment.type === 'webpage' ? (
                  <button
                    type="button"
                    onClick={() => openUrl(attachment.name)}
                    className="hover:underline cursor-pointer"
                  >
                    {attachment.name}
                  </button>
                ) : (
                  <span className="max-w-[150px] truncate">{attachment.name}</span>
                )}
                {attachment.size !== undefined && (
                  <span className="text-xs opacity-60">({formatFileSize(attachment.size)})</span>
                )}
              </>
            )}
          </Badge>
        )
      })}
    </div>
  )
}
