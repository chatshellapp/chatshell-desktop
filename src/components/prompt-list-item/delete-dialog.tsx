import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface DeletePromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  promptName?: string
}

export function DeletePromptDialog({
  open,
  onOpenChange,
  onConfirm,
  promptName,
}: DeletePromptDialogProps) {
  const { t } = useTranslation('prompts')
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deletePrompt')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('confirmDelete', { name: promptName ? `"${promptName}"` : 'this prompt' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {t('delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
