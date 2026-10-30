import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MorphSpinner } from '@/components/ui/morph-spinner'

/** Elapsed seconds as "12s", then "1:05". */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Placeholder body of a reply that has not produced its first event: copy
 * and an elapsed timer instead of an unexplained spinner. The timer counts
 * from mount; the streaming row remounts it for every new wait.
 */
export function WaitingForResponse() {
  const { t } = useTranslation('chat')
  const [startedAt] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return (
    <div data-waiting-for-response="true" className="flex items-center gap-2 py-2 not-prose">
      <MorphSpinner size={16} />
      <span className="text-sm text-muted-foreground">{t('turn.waitingForResponse')}</span>
      <span className="text-xs text-muted-foreground/70 tabular-nums">
        {formatElapsed(elapsed)}
      </span>
    </div>
  )
}
