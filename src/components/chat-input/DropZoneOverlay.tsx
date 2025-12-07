import { Upload } from 'lucide-react'

interface DropZoneOverlayProps {
  isVisible: boolean
}

export function DropZoneOverlay({ isVisible }: DropZoneOverlayProps) {
  if (!isVisible) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
      <div className="flex flex-col items-center gap-2 text-primary">
        <Upload className="size-8" />
        <span className="text-sm font-medium">Drop files here</span>
        <span className="text-xs text-muted-foreground">Documents or Images</span>
      </div>
    </div>
  )
}

