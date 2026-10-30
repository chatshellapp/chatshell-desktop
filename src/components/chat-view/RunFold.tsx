import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, ChevronDown, ChevronRight, CircleSlash } from 'lucide-react'
import { MorphSpinner } from '@/components/ui/morph-spinner'
import { useRunFoldStore } from '@/stores/runFoldStore'
import type { RunOutcome } from '@/stores/message/types'

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped'

/** Status of a saved run: the session outcome first, then persisted tool
 * calls (a stop leaves unfinished calls `cancelled`). */
export function savedRunStatus(
  outcome: RunOutcome | undefined,
  toolStatuses: readonly string[]
): RunStatus {
  if (outcome) return outcome.kind
  if (toolStatuses.includes('cancelled')) return 'stopped'
  return 'completed'
}

interface RunFoldProps {
  /** Message id, or the live key while streaming. */
  foldKey: string
  /** Live runs open by default; finished and historical runs are closed. */
  live: boolean
  status: RunStatus
  steps: number
  failedTools: number
  children: ReactNode
}

/**
 * One header over a run's process (thinking, tool calls, text between tool
 * calls); the final answer renders outside. A manual toggle wins for the
 * session, and a toggle on the live run carries over to the saved reply.
 */
export function RunFold({ foldKey, live, status, steps, failedTools, children }: RunFoldProps) {
  const { t } = useTranslation('chat')
  const override = useRunFoldStore((state) => state.overrides[foldKey])
  const setExpanded = useRunFoldStore((state) => state.setExpanded)
  const expanded = override ?? live

  const icon =
    status === 'running' ? (
      <MorphSpinner size={14} />
    ) : status === 'failed' ? (
      <AlertCircle className="h-3.5 w-3.5 text-destructive" />
    ) : status === 'stopped' ? (
      <CircleSlash className="h-3.5 w-3.5 text-muted-foreground" />
    ) : (
      <Check className="h-3.5 w-3.5 text-muted-foreground" />
    )

  return (
    <div data-run-fold={status} className="rounded border border-muted/50 bg-muted/10">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(foldKey, !expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
        <span
          className={`font-medium ${status === 'failed' ? 'text-destructive' : 'text-foreground/80'}`}
        >
          {t(`runFold.${status}`)}
        </span>
        <span className="text-muted-foreground">{t('runFold.steps', { count: steps })}</span>
        {failedTools > 0 && (
          <span className="text-destructive">
            {t('runFold.failedTools', { count: failedTools })}
          </span>
        )}
        <span className="ml-auto text-muted-foreground/60">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {expanded && <div className="space-y-1.5 px-2.5 pb-2.5">{children}</div>}
    </div>
  )
}
