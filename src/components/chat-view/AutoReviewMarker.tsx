// Auto-mode review card under a tool call (permission v3), styled like the
// tool call cards it sits between: a collapsible header with the reviewed
// action, the outcome and risk as badges, and the review time; the body
// holds the reviewer's rationale and the user-authorization level. Denials,
// review failures, and sandbox blocks open expanded and offer an inline
// "run anyway", which arms a one-shot override for that exact action
// (never a grant) and asks the model to retry it through the composer.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Play, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import {
  canRunAnyway,
  requestComposeSubmit,
  useAutoReviewStore,
  type AutoReviewMarker as Marker,
  type AutoReviewRisk,
} from '@/stores/autoReviewStore'
import { useMessageStore } from '@/stores/message'
import { formatDuration } from '@/components/attachment-preview/tool-output-renderers'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

interface RunAnywayTicket {
  toolName: string
  subject: string
  unsandboxed: boolean
}

const BADGE = 'inline-flex shrink-0 items-center rounded-full border px-1.5 text-2xs leading-4'
const NEUTRAL_BADGE = 'border-border bg-muted/60 text-muted-foreground'
const WARNING_BADGE = 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
const DANGER_BADGE = 'border-destructive/30 bg-destructive/10 text-destructive'
const SUCCESS_BADGE =
  'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'

/** Risk badge colors (severity coloring). */
const RISK_BADGE: Record<AutoReviewRisk, string> = {
  low: NEUTRAL_BADGE,
  medium: NEUTRAL_BADGE,
  high: WARNING_BADGE,
  critical: DANGER_BADGE,
}

function statusBadgeClass(marker: Marker): string {
  switch (marker.kind) {
    case 'allowed':
      return SUCCESS_BADGE
    case 'denied':
      return marker.riskLevel === 'critical' ? DANGER_BADGE : WARNING_BADGE
    case 'failed':
    case 'jail_denied':
      return WARNING_BADGE
    case 'override':
      return NEUTRAL_BADGE
  }
}

function iconClass(marker: Marker): string {
  switch (marker.kind) {
    case 'allowed':
    case 'override':
      return 'text-muted-foreground/70'
    case 'denied':
      return marker.riskLevel === 'critical'
        ? 'text-destructive'
        : 'text-amber-600 dark:text-amber-400'
    case 'failed':
    case 'jail_denied':
      return 'text-amber-600 dark:text-amber-400'
  }
}

interface AutoReviewMarkerProps {
  toolCallId: string
  /** The reviewed action as shown in the header (the command for bash). */
  subject?: string | null
}

export function AutoReviewMarker({ toolCallId, subject }: AutoReviewMarkerProps) {
  const marker = useAutoReviewStore((state) => state.markers[toolCallId])
  if (!marker) return null
  // Keyed by decision: a later decision for the same call (a sandbox block
  // after an allow) gets its own initial expansion.
  return (
    <ReviewCard
      key={`${marker.decisionId ?? ''}:${marker.kind}`}
      marker={marker}
      subject={subject}
    />
  )
}

function ReviewCard({ marker, subject }: { marker: Marker; subject?: string | null }) {
  const { t } = useTranslation('chat')
  const markOverridden = useAutoReviewStore((state) => state.markOverridden)
  const isStreaming = useMessageStore(
    (state) => state.getConversationState(marker.conversationId).isStreaming
  )
  const [running, setRunning] = useState(false)
  // Blocks open expanded: the reason is what the user needs to act on.
  const [isExpanded, setIsExpanded] = useState(() => canRunAnyway(marker))

  const detail =
    marker.rationale ??
    (marker.kind === 'failed' || marker.kind === 'jail_denied' || marker.kind === 'override'
      ? t(`autoReview.detail.${marker.kind}`)
      : null)
  const authorization = marker.userAuthorization
    ? t('autoReview.authorization', {
        level: t(`autoReview.authorizationLevel.${marker.userAuthorization}`),
      })
    : null
  const canExpand = Boolean(detail || authorization || marker.overridden)
  const duration = formatDuration(marker.durationMs ?? undefined)
  const showRunAnyway = canRunAnyway(marker)

  const Icon =
    marker.kind === 'allowed' || marker.kind === 'override'
      ? ShieldCheck
      : marker.kind === 'denied'
        ? ShieldX
        : ShieldAlert

  const runAnyway = async () => {
    if (!marker.decisionId) return
    setRunning(true)
    try {
      const ticket = await invoke<RunAnywayTicket>('auto_review_run_anyway', {
        conversationId: marker.conversationId,
        decisionId: marker.decisionId,
      })
      markOverridden(marker.decisionId)
      requestComposeSubmit({
        conversationId: marker.conversationId,
        text: ticket.unsandboxed
          ? t('autoReview.runAnywayUnsandboxedMessage', { subject: ticket.subject })
          : t('autoReview.runAnywayMessage', { subject: ticket.subject }),
      })
    } catch (error) {
      logger.error('[AutoReviewMarker] run anyway failed:', error)
      toast.error(t('autoReview.runAnywayFailed'))
    } finally {
      setRunning(false)
    }
  }

  const containerClass = isExpanded
    ? 'w-full rounded border border-muted/50 bg-muted/20 overflow-hidden'
    : 'w-fit max-w-full rounded border border-transparent bg-muted/20 overflow-hidden'

  return (
    <div className={containerClass} data-testid="auto-review-marker" data-kind={marker.kind}>
      <div className="flex items-center min-w-0">
        <button
          type="button"
          onClick={() => canExpand && setIsExpanded(!isExpanded)}
          aria-expanded={canExpand ? isExpanded : undefined}
          className={cn(
            'flex items-center gap-2 px-2.5 py-1.5 flex-1 min-w-0 text-left transition-colors',
            canExpand ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'
          )}
        >
          <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', iconClass(marker))} />
          <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
            {t('autoReview.title')}
          </span>
          {subject && (
            <span className="text-xs text-muted-foreground/50 truncate min-w-0 font-mono">
              {subject}
            </span>
          )}
          <span className={cn(BADGE, statusBadgeClass(marker))}>
            {t(`autoReview.status.${marker.kind}`)}
          </span>
          {marker.riskLevel && (
            <span className={cn(BADGE, RISK_BADGE[marker.riskLevel])}>
              {t(`autoReview.risk.${marker.riskLevel}`)}
            </span>
          )}
          {duration && (
            <span className="text-xs text-muted-foreground/40 flex-shrink-0">{duration}</span>
          )}
          {canExpand && (
            <span className="flex items-center text-muted-foreground/60 flex-shrink-0 ml-auto">
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          )}
        </button>
        {showRunAnyway && (
          <button
            type="button"
            onClick={() => void runAnyway()}
            disabled={running || isStreaming}
            title={isStreaming ? t('autoReview.runAnywayWhenDone') : undefined}
            className="mr-1.5 inline-flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="size-3" />
            {marker.kind === 'jail_denied'
              ? t('autoReview.runAnywayUnsandboxed')
              : t('autoReview.runAnyway')}
          </button>
        )}
      </div>

      {isExpanded && canExpand && (
        <div className="border-t border-muted/50 px-2.5 py-2.5 space-y-2 text-xs">
          {detail && (
            <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
              {detail}
            </p>
          )}
          {(authorization || marker.overridden) && (
            <div
              className={cn(
                'flex flex-wrap items-center gap-x-2 text-muted-foreground/70',
                detail && 'border-t border-muted/50 pt-2'
              )}
            >
              {authorization && <span>{authorization}</span>}
              {authorization && marker.overridden && <span>·</span>}
              {marker.overridden && <span>{t('autoReview.overridden')}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
