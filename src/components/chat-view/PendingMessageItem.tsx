import { RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface PendingMessageItemProps {
  content: string
  // Why sending this queued message failed; it then waits for a retry
  error?: string
  onRetry?: () => void
  onRemove: () => void
}

export function PendingMessageItem({ content, error, onRetry, onRemove }: PendingMessageItemProps) {
  const { t } = useTranslation('chat')

  return (
    <div className="flex justify-end items-center gap-1.5 px-4 my-1">
      <div className="flex flex-col items-end max-w-[80%] min-w-0">
        <div className="px-4 py-3 bg-muted/50 rounded-lg opacity-60 max-w-full">
          <p className="text-base text-foreground whitespace-pre-wrap">{content}</p>
        </div>
        {error && (
          <p className="mt-1 text-xs text-destructive line-clamp-2 break-words" title={error}>
            {error}
          </p>
        )}
      </div>
      <TooltipProvider delayDuration={300}>
        {error && onRetry && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t('retryQueued')}
                onClick={onRetry}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('retryQueued')}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={t('removeQueued')}
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
