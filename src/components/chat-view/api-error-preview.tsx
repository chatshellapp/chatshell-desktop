import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ApiErrorPreviewProps {
  error: string
  onDismiss?: () => void
}

export function ApiErrorPreview({ error, onDismiss }: ApiErrorPreviewProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-destructive/50 bg-destructive/5 text-left hover:border-destructive/70 transition-colors cursor-pointer"
      >
        <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        <span className="flex-1 text-sm truncate">
          <span className="font-medium text-destructive">API Error</span>
          <span className="text-muted-foreground ml-2 truncate">{error}</span>
        </span>
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              API Error
            </DialogTitle>
          </DialogHeader>

          <div className="px-3 py-2 bg-destructive/10 rounded-md">
            <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false)
                onDismiss?.()
              }}
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

