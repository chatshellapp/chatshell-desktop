import { useState } from 'react'
import { Link } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Attachment } from './types'

interface WebPageDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (url: string) => void
  existingAttachments: Attachment[]
}

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function WebPageDialog({
  isOpen,
  onOpenChange,
  onSubmit,
  existingAttachments,
}: WebPageDialogProps) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    const trimmedUrl = url.trim()

    if (!trimmedUrl) {
      setError('Please enter a URL')
      return
    }

    if (!validateUrl(trimmedUrl)) {
      setError('Please enter a valid URL (e.g., https://example.com)')
      return
    }

    // Check for duplicate
    const isDuplicate = existingAttachments.some(
      (att) => att.type === 'webpage' && att.name === trimmedUrl
    )
    if (isDuplicate) {
      setError('This URL has already been added')
      return
    }

    onSubmit(trimmedUrl)
    handleClose()
  }

  const handleClose = () => {
    setUrl('')
    setError('')
    onOpenChange(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleClose()
    } else {
      onOpenChange(open)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="size-5" />
            Add Web Page
          </DialogTitle>
          <DialogDescription>
            Enter a URL to attach web page content to your message.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Input
            placeholder="https://example.com"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSubmit()
              }
            }}
            aria-invalid={!!error}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="sm:justify-end">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

