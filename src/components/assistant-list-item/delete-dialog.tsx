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

interface DeleteAssistantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  assistantName?: string
}

export function DeleteAssistantDialog({
  open,
  onOpenChange,
  onConfirm,
  assistantName,
}: DeleteAssistantDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Assistant</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete {assistantName ? `"${assistantName}"` : 'this assistant'}?
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

