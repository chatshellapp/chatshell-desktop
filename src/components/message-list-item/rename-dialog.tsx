import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface RenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentTitle: string
  onRename: (newTitle: string) => void
}

export function RenameDialog({ open, onOpenChange, currentTitle, onRename }: RenameDialogProps) {
  const [value, setValue] = React.useState(currentTitle)

  // Sync value when dialog opens
  React.useEffect(() => {
    if (open) {
      setValue(currentTitle)
    }
  }, [open, currentTitle])

  const handleSubmit = () => {
    if (value.trim() && value !== currentTitle) {
      onRename(value.trim())
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Rename Conversation</DialogTitle>
          <DialogDescription>Enter a new title for this conversation.</DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Conversation title"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
