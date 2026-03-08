'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('providers')
  const [modelId, setModelId] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!modelId.trim()) {
      setError(t('modelIdRequired'))
      return
    }

    const success = onAddModel(modelId, displayName || undefined)
    if (!success) {
      setError(t('modelAlreadyExists'))
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
        <DialogTitle>{t('addModelManually')}</DialogTitle>
        <DialogDescription>{t('enterModelIdentifier')}</DialogDescription>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model-id">{t('modelId')}</Label>
            <Input
              id="model-id"
              placeholder={t('modelIdPlaceholder')}
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value)
                setError(null)
              }}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="display-name">{t('displayNameOptional')}</Label>
            <Input
              id="display-name"
              placeholder={t('displayNamePlaceholder')}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common:cancel')}
            </Button>
            <Button type="submit">{t('common:add')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
