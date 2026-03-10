import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface PendingMessageItemProps {
  content: string
  onRemove: () => void
}

export function PendingMessageItem({ content, onRemove }: PendingMessageItemProps) {
  const { t } = useTranslation('chat')

  return (
    <div className="flex justify-end items-center gap-1.5 px-4 my-1 opacity-60">
      <div className="px-4 py-3 bg-muted/50 rounded-lg max-w-[80%]">
        <p className="text-base text-foreground whitespace-pre-wrap">{content}</p>
      </div>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
            >
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('removeQueued')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
