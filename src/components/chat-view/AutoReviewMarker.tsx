// Low-noise auto-mode marker under a tool call (permission v3): what the
// auto reviewer decided, colored by risk, with an inline "run anyway" on
// denials, review failures, and sandbox blocks. Run-anyway arms a
// one-shot override for that exact action (never a grant) and asks the
// model to retry it through the composer.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { ShieldAlert, ShieldCheck, ShieldX, Play } from 'lucide-react'
import {
  canRunAnyway,
  requestComposeSubmit,
  useAutoReviewStore,
  type AutoReviewMarker as Marker,
  type AutoReviewRisk,
} from '@/stores/autoReviewStore'
import { useMessageStore } from '@/stores/message'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

interface RunAnywayTicket {
  toolName: string
  subject: string
  unsandboxed: boolean
}

/** Text color per risk level (severity coloring). */
const RISK_CLASS: Record<AutoReviewRisk, string> = {
  low: 'text-muted-foreground',
  medium: 'text-muted-foreground',
  high: 'text-amber-600 dark:text-amber-400',
  critical: 'text-destructive',
}

function markerClass(marker: Marker): string {
  switch (marker.kind) {
    case 'allowed':
      return marker.riskLevel ? RISK_CLASS[marker.riskLevel] : 'text-muted-foreground'
    case 'denied':
      return marker.riskLevel === 'critical'
        ? 'text-destructive'
        : 'text-amber-600 dark:text-amber-400'
    case 'failed':
    case 'jail_denied':
      return 'text-amber-600 dark:text-amber-400'
    case 'override':
      return 'text-muted-foreground'
  }
}

export function AutoReviewMarker({ toolCallId }: { toolCallId: string }) {
  const { t } = useTranslation('chat')
  const marker = useAutoReviewStore((state) => state.markers[toolCallId])
  const markOverridden = useAutoReviewStore((state) => state.markOverridden)
  const isStreaming = useMessageStore((state) =>
    marker ? state.getConversationState(marker.conversationId).isStreaming : false
  )
  const [running, setRunning] = useState(false)
  if (!marker) return null

  const risk = marker.riskLevel ? t(`autoReview.risk.${marker.riskLevel}`) : null
  let label: string
  switch (marker.kind) {
    case 'allowed':
      label = risk ? t('autoReview.allowedWithRisk', { risk }) : t('autoReview.allowed')
      break
    case 'denied':
      label = marker.rationale
        ? t('autoReview.deniedWithReason', { reason: marker.rationale })
        : t('autoReview.denied')
      break
    case 'failed':
      label = t('autoReview.failed')
      break
    case 'jail_denied':
      label = t('autoReview.jailDenied')
      break
    case 'override':
      label = t('autoReview.override')
      break
  }
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

  return (
    <div
      className={cn('flex items-center gap-1.5 px-1 pt-0.5 text-xs', markerClass(marker))}
      data-testid="auto-review-marker"
      data-kind={marker.kind}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate" title={marker.rationale ?? undefined}>
        {label}
      </span>
      {marker.overridden && (
        <span className="text-muted-foreground">· {t('autoReview.overridden')}</span>
      )}
      {canRunAnyway(marker) && (
        <button
          type="button"
          onClick={() => void runAnyway()}
          disabled={running || isStreaming}
          title={isStreaming ? t('autoReview.runAnywayWhenDone') : undefined}
          className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="size-3" />
          {marker.kind === 'jail_denied'
            ? t('autoReview.runAnywayUnsandboxed')
            : t('autoReview.runAnyway')}
        </button>
      )}
    </div>
  )
}
