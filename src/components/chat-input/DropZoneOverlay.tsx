import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'

interface DropZoneOverlayProps {
  isVisible: boolean
}

export function DropZoneOverlay({ isVisible }: DropZoneOverlayProps) {
  const { t } = useTranslation()
  if (!isVisible) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
      <div className="flex flex-col items-center gap-2 text-primary">
        <Upload className="size-8" />
        <span className="text-sm font-medium">{t('chat:dropFilesHere')}</span>
        <span className="text-xs text-muted-foreground">{t('chat:documentsOrImages')}</span>
      </div>
    </div>
  )
}
