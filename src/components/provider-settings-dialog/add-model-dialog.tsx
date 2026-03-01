'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AddModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddModel: (modelId: string, displayName?: string) => boolean
}

export function AddModelDialog({ open, onOpenChange, onAddModel }: AddModelDialogProps) {
  const [modelId, setModelId] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!modelId.trim()) {
      setError('Model ID is required')
      return
    }

    const success = onAddModel(modelId, displayName || undefined)
    if (!success) {
      setError('A model with this ID already exists')
      return
    }

    setModelId('')
    setDisplayName('')
    onOpenChange(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setModelId('')
      setDisplayName('')
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogTitle>Add Model Manually</DialogTitle>
        <DialogDescription>
          Enter the model identifier used for API calls.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model-id">Model ID</Label>
            <Input
              id="model-id"
              placeholder="e.g. gpt-4o, claude-3-opus-20240229"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value)
                setError(null)
              }}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="display-name">Display Name (optional)</Label>
            <Input
              id="display-name"
              placeholder="Defaults to Model ID if empty"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
