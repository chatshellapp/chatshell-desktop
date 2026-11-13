import { useTranslation } from 'react-i18next'
import { FileText, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { MentionState } from './hooks/useMentions'

interface MentionPopupProps {
  state: MentionState | null
  onPick: (path: string) => void
  /** The composer the popup is anchored to; must accept a ref. */
  children: ReactNode
}

/**
 * The @-mention file list shown above the composer. It renders in a portal so
 * the composer's scroll container cannot clip it. Open state is owned by the
 * mention hook; focus stays in the textarea, which handles all keys.
 */
export function MentionPopup({ state, onPick, children }: MentionPopupProps) {
  return (
    <Popover open={state !== null}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      {state && (
        <PopoverContent
          data-testid="mention-popup"
          side="top"
          align="start"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="w-(--radix-popover-trigger-width) max-w-md rounded-md p-0"
        >
          <MentionList state={state} onPick={onPick} />
        </PopoverContent>
      )}
    </Popover>
  )
}

function MentionList({ state, onPick }: { state: MentionState; onPick: (path: string) => void }) {
  const { t } = useTranslation('chat')
  return state.noWorkingDirectory ? (
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
}
