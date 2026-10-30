import { useTranslation } from 'react-i18next'
import { AlertTriangle, CircleSlash, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FailedTurn as FailedTurnState, RunOutcome } from '@/stores/message/types'
import { ApiErrorPreview } from './api-error-preview'

interface FailedTurnProps {
  failedTurn: FailedTurnState
  /** Retry is unavailable while another generation streams. */
  disabled: boolean
  onRetry: () => void
  onDismiss: () => void
  onShowPreviousReply: () => void
}

/**
 * A turn whose generation ended without a saved reply: send/run failure or
 * a stop before any output. Session-only; rendered after the unanswered
 * user message in place of an assistant row.
 */
export function FailedTurn({
  failedTurn,
  disabled,
  onRetry,
  onDismiss,
  onShowPreviousReply,
}: FailedTurnProps) {
  const { t } = useTranslation(['chat', 'common'])
  const failed = failedTurn.kind === 'failed'

  return (
    <div
      data-failed-turn="true"
      className={`mx-8 my-2 rounded-lg border px-3 py-2.5 space-y-1.5 ${
        failed ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/30'
      }`}
    >
      <div className="flex items-center gap-2">
        {failed ? (
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        ) : (
          <CircleSlash className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <span className={`text-sm font-medium ${failed ? 'text-destructive' : ''}`}>
          {failed ? t('chat:turn.sendFailed') : t('chat:turn.stoppedBeforeResponse')}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {failedTurn.previousReplyId && (
            <Button variant="ghost" size="sm" className="h-7" onClick={onShowPreviousReply}>
              {t('chat:turn.showPreviousReply')}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7" onClick={onDismiss}>
            {t('common:dismiss')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            disabled={disabled}
            onClick={onRetry}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('common:retry')}
          </Button>
        </div>
      </div>
      {failedTurn.error && <ApiErrorPreview error={failedTurn.error} onDismiss={onDismiss} />}
    </div>
  )
}

interface RunOutcomeFooterProps {
  outcome: RunOutcome
  onRetry: () => void
}

/** Status line under a saved reply that kept partial output after a
 * failure or a stop. */
export function RunOutcomeFooter({ outcome, onRetry }: RunOutcomeFooterProps) {
  const { t } = useTranslation(['chat', 'common'])
  const failed = outcome.kind === 'failed'

  return (
    <div data-run-outcome={outcome.kind} className="flex items-center gap-2 mb-2 min-w-0">
      {failed ? (
        <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
      ) : (
        <CircleSlash className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      )}
      <span
        className={`text-xs font-medium shrink-0 ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {failed ? t('chat:turn.runFailed') : t('chat:turn.runStopped')}
      </span>
      {outcome.error && (
        <div className="min-w-0 flex-1">
          <ApiErrorPreview error={outcome.error} />
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2 text-xs shrink-0 ml-auto"
        onClick={onRetry}
      >
        <RotateCcw className="h-3 w-3" />
        {t('common:retry')}
      </Button>
    </div>
  )
}
