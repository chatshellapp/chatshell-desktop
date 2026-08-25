import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { computeUnifiedDiff, DIFF_MAX_ROWS, type DiffRow } from '@/lib/tool-diff'

interface DiffViewProps {
  oldText: string
  newText: string
  maxRows?: number
}

const ROW_CLASSES: Record<DiffRow['type'], string> = {
  hunk: 'bg-muted/50 text-muted-foreground/60',
  context: 'text-foreground/80',
  add: 'bg-green-500/10 text-green-700 dark:text-green-400',
  remove: 'bg-red-500/10 text-red-700 dark:text-red-400',
}

const SEGMENT_CLASSES = {
  add: 'bg-green-500/30 rounded-[2px]',
  remove: 'bg-red-500/30 rounded-[2px]',
}

function rowMarker(type: DiffRow['type']): string {
  if (type === 'add') return '+'
  if (type === 'remove') return '-'
  return ''
}

/**
 * Unified diff view with old/new line-number gutters, +/- tinted rows, and
 * word-level highlight on paired changed lines. Identical inputs render
 * nothing. Rows beyond maxRows are replaced by a "N more lines" footer.
 */
export function DiffView({ oldText, newText, maxRows = DIFF_MAX_ROWS }: DiffViewProps) {
  const { t } = useTranslation('tools')
  const diff = useMemo(
    () => computeUnifiedDiff(oldText, newText, undefined, maxRows),
    [oldText, newText, maxRows]
  )

  if (diff.rows.length === 0) return null

  const maxLineNumber = diff.rows.reduce(
    (max, row) => Math.max(max, row.oldLine ?? 0, row.newLine ?? 0),
    0
  )
  const gutterWidth = `${Math.max(2, String(maxLineNumber).length)}ch`

  return (
    <div className="rounded border border-muted/50 overflow-hidden font-mono text-xs">
      <div className="overflow-x-auto">
        {diff.rows.map((row, index) => {
          const isChangeRow = row.type === 'add' || row.type === 'remove'
          const segClass = row.type === 'add' ? SEGMENT_CLASSES.add : SEGMENT_CLASSES.remove
          return (
            <div
              key={index}
              className={`flex items-start ${ROW_CLASSES[row.type]}`}
              data-diff-row={row.type}
            >
              <span
                className="flex-shrink-0 text-right text-muted-foreground/40 select-none px-1"
                style={{ width: gutterWidth }}
              >
                {row.oldLine ?? ''}
              </span>
              <span
                className="flex-shrink-0 text-right text-muted-foreground/40 select-none px-1"
                style={{ width: gutterWidth }}
              >
                {row.newLine ?? ''}
              </span>
              <span className="flex-shrink-0 w-4 text-center select-none">
                {row.type === 'hunk' ? '' : rowMarker(row.type)}
              </span>
              <span className="flex-1 whitespace-pre pr-3">
                {isChangeRow && row.segments
                  ? row.segments.map((segment, i) => (
                      <span key={i} className={segment.changed ? segClass : undefined}>
                        {segment.text}
                      </span>
                    ))
                  : isChangeRow
                    ? row.content || ' '
                    : row.content}
              </span>
            </div>
          )
        })}
        {diff.truncated > 0 && (
          <div
            className="px-3 py-1 bg-muted/30 text-muted-foreground/50 select-none"
            data-testid="diff-more-lines"
          >
            {t('diffView.moreLines', { n: diff.truncated })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Collapsed-header badge: `+N [proportional strip] -M` (Ferngeist pattern).
 */
export function DiffStatsBadge({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions
  if (total === 0) return null

  let green = Math.round((5 * additions) / total)
  let red = Math.round((5 * deletions) / total)
  if (additions > 0 && green === 0) green = 1
  if (deletions > 0 && red === 0) red = 1
  const overflow = green + red - 5
  if (overflow > 0) {
    if (green >= red) green -= overflow
    else red -= overflow
  }

  const blocks = Array.from({ length: 5 }, (_, i): 'add' | 'remove' | 'empty' => {
    if (i < green) return 'add'
    if (i < green + red) return 'remove'
    return 'empty'
  })

  return (
    <span
      className="flex items-center gap-1.5 flex-shrink-0"
      title={`+${additions} -${deletions}`}
      data-testid="diff-stats"
    >
      <span className="text-[10px] font-mono text-green-600 dark:text-green-400">+{additions}</span>
      <span className="flex gap-[2px] items-center">
        {blocks.map((block, i) => (
          <span
            key={i}
            className={`h-2 w-2 rounded-[2px] ${
              block === 'add'
                ? 'bg-green-500/70'
                : block === 'remove'
                  ? 'bg-red-500/70'
                  : 'bg-muted'
            }`}
          />
        ))}
      </span>
      <span className="text-[10px] font-mono text-red-600 dark:text-red-400">-{deletions}</span>
    </span>
  )
}
