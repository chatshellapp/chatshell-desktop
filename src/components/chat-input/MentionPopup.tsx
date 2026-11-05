import { useTranslation } from 'react-i18next'
import { FileText, Loader2 } from 'lucide-react'
import type { MentionState } from './hooks/useMentions'

interface MentionPopupProps {
  state: MentionState
  onPick: (path: string) => void
}

/** The @-mention file list shown above the composer. */
export function MentionPopup({ state, onPick }: MentionPopupProps) {
  const { t } = useTranslation('chat')
  const body = state.noWorkingDirectory ? (
    <div className="px-3 py-2 text-xs text-muted-foreground">{t('mention.noWorkingDirectory')}</div>
  ) : state.loading ? (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      {t('mention.loading')}
    </div>
  ) : state.matches.length === 0 ? (
    <div className="px-3 py-2 text-xs text-muted-foreground">{t('mention.noMatches')}</div>
  ) : (
    <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
      {state.matches.map((path, index) => (
        <li
          key={path}
          role="option"
          aria-selected={index === state.selected}
          // Keep textarea focus: pick on mousedown.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(path)
          }}
          className={`flex cursor-pointer items-center gap-2 px-3 py-1 text-sm ${
            index === state.selected ? 'bg-accent text-accent-foreground' : ''
          }`}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{path}</span>
        </li>
      ))}
    </ul>
  )
  return (
    <div
      data-testid="mention-popup"
      className="absolute bottom-full left-0 z-50 mb-2 w-full max-w-md rounded-md border bg-popover shadow-md"
    >
      {body}
    </div>
  )
}
