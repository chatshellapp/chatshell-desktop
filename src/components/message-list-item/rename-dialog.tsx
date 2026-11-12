import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  /** Dialog title; defaults to the conversation rename title */
  title?: string
  /** Dialog description; defaults to the conversation rename hint */
  description?: string
  /** Input placeholder; defaults to the conversation title placeholder */
  placeholder?: string
}

export function RenameDialog({
  open,
  onOpenChange,
  currentTitle,
  onRename,
  title,
  description,
  placeholder,
}: RenameDialogProps) {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')
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
          <DialogTitle>{title ?? t('renameConversation')}</DialogTitle>
          <DialogDescription>{description ?? t('enterNewTitle')}</DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? t('conversationTitlePlaceholder')}
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
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSubmit}>{tCommon('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
