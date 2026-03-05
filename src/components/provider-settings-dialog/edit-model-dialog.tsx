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
import type { ModelItem } from './types'

interface EditModelDialogProps {
  open: boolean
  model: ModelItem | null
  onOpenChange: (open: boolean) => void
  onSave: (id: string, modelId: string, displayName: string) => void
}

export function EditModelDialog({ open, model, onOpenChange, onSave }: EditModelDialogProps) {
  const [modelId, setModelId] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open && model) {
      setModelId(model.modelId)
      setDisplayName(model.displayName)
      setError(null)
    }
  }, [open, model])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!modelId.trim()) {
      setError('Model ID is required')
      return
    }

    if (!displayName.trim()) {
      setError('Display name is required')
      return
    }

    if (model) {
      onSave(model.id, modelId.trim(), displayName.trim())
      onOpenChange(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogTitle>Edit Model</DialogTitle>
        <DialogDescription>Modify the model identifier and display name.</DialogDescription>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-model-id">Model ID</Label>
            <Input
              id="edit-model-id"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value)
                setError(null)
              }}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-display-name">Display Name</Label>
            <Input
              id="edit-display-name"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value)
                setError(null)
              }}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
